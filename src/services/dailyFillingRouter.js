const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config/config');

const dlRenewalService = require('./dlRenewalService');
const applyDlService = require('./applyDlService');
const paymentService = require('./paymentService');
const slotBookingService = require('./slotBookingService');
const { normalizeDob } = require('./commandInputService');

const {
  getDlRenewalSessions,
  getApplyDlSessions,
  getPaymentSessions,
  getSlotBookingSessions
} = require('../workers/browserWorker');

function cleanupFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
}

function parseArgs(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Handle daily filling messages and commands for WhatsApp
 * @returns {Promise<boolean>} true if message was handled, false otherwise
 */
async function handleDailyFillingWhatsAppMessage(message, client, enqueueOrReply) {
  const normalizedBody = String(message.body || '').trim();
  const lowerBody = normalizedBody.toLowerCase();

  // 1. Session Resumption
  const dlRenewalSessions = getDlRenewalSessions();
  if (dlRenewalSessions.has(message.from) && !normalizedBody.startsWith('/dlrenewal')) {
    const flow = dlRenewalSessions.get(message.from);
    const otpCode = normalizedBody.trim();
    if (otpCode.length > 0 && otpCode.length <= 8) {
      dlRenewalSessions.delete(message.from);
      await message.reply('⏳ OTP received. Filling Self-Declaration Form 1 popup and submitting DL Renewal...');
      try {
        const slipPath = await dlRenewalService.submitDLRenewalOTP(flow.browser, flow.context, flow.page, otpCode);
        const media = MessageMedia.fromFilePath(slipPath);
        await client.sendMessage(message.from, media, { caption: '✅ DL Renewal Successful! Here is your acknowledgement reference slip.' });
        cleanupFile(slipPath);
        if (flow.resolveJob) flow.resolveJob({ ok: true, slipPath });
      } catch (error) {
        await message.reply(`❌ DL Renewal failed: ${error.message || error}`);
        if (flow.rejectJob) flow.rejectJob(error);
        else {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      }
      return true;
    }
  }

  const applyDlSessions = getApplyDlSessions();
  if (applyDlSessions.has(message.from) && !normalizedBody.startsWith('/applydl')) {
    const flow = applyDlSessions.get(message.from);
    const otpCode = normalizedBody.trim();
    if (otpCode.length > 0 && otpCode.length <= 8) {
      applyDlSessions.delete(message.from);
      await message.reply('⏳ OTP received. Booking class of vehicles, completing Self-Declaration Form 1, and finalising DL application...');
      try {
        const details = await applyDlService.submitApplyDLOTP(flow.browser, flow.context, flow.page, otpCode);
        await message.reply(`✅ DL Application Submitted Successfully!\n📝 Application Details: ${details.extractedText}`);
        if (flow.resolveJob) flow.resolveJob({ ok: true, details });
      } catch (error) {
        await message.reply(`❌ DL Application failed: ${error.message || error}`);
        if (flow.rejectJob) flow.rejectJob(error);
        else {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      }
      return true;
    }
  }

  const paymentSessions = getPaymentSessions();
  if (paymentSessions.has(message.from) && !normalizedBody.startsWith('/payfee')) {
    if (/^paid$/i.test(normalizedBody)) {
      const flow = paymentSessions.get(message.from);
      paymentSessions.delete(message.from);
      await message.reply('⏳ Payment marked as paid. Waiting for portal redirect and downloading receipt...');
      try {
        const receiptPath = await paymentService.confirmPayment(flow.browser, flow.context, flow.page, flow.appNo);
        const media = MessageMedia.fromFilePath(receiptPath);
        await client.sendMessage(message.from, media, { caption: `✅ Payment receipt downloaded successfully for Application No: ${flow.appNo}.` });
        cleanupFile(receiptPath);
        if (flow.resolveJob) flow.resolveJob({ ok: true, receiptPath });
      } catch (error) {
        await message.reply(`❌ Failed to retrieve payment receipt: ${error.message || error}`);
        if (flow.rejectJob) flow.rejectJob(error);
        else {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      }
      return true;
    }
  }

  const slotBookingSessions = getSlotBookingSessions();
  if (slotBookingSessions.has(message.from) && !normalizedBody.startsWith('/bookslot')) {
    const flow = slotBookingSessions.get(message.from);
    if (flow.waitingForOtp) {
      const otpCode = normalizedBody.trim();
      if (otpCode.length > 0 && otpCode.length <= 8) {
        slotBookingSessions.delete(message.from);
        await message.reply('⏳ Submitting slot booking OTP and generating confirmation...');
        try {
          const docPath = await slotBookingService.confirmSlotBookingOTP(flow.browser, flow.context, flow.page, otpCode);
          const media = MessageMedia.fromFilePath(docPath);
          await client.sendMessage(message.from, media, { caption: '🎉 Slot Booked Successfully! Here is your booking confirmation slip.' });
          cleanupFile(docPath);
          if (flow.resolveJob) flow.resolveJob({ ok: true, docPath });
        } catch (error) {
          await message.reply(`❌ Booking OTP verification failed: ${error.message || error}`);
          if (flow.rejectJob) flow.rejectJob(error);
          else {
            if (flow.context) await flow.context.close().catch(() => {});
            if (flow.browser) await flow.browser.close().catch(() => {});
          }
        }
        return true;
      }
    } else {
      const choice = normalizedBody.trim();
      await message.reply('⏳ Caching slot date, triggering booking SMS OTP...');
      try {
        if (/^auto$/i.test(choice)) {
          await slotBookingService.bookPreferredSlot(flow.context, flow.page, null, null);
        } else {
          await slotBookingService.bookPreferredSlot(flow.context, flow.page, choice, null);
        }
        flow.waitingForOtp = true;
        await message.reply('🔐 SMS OTP has been sent for booking confirmation. Please reply with the OTP code.');
      } catch (error) {
        slotBookingSessions.delete(message.from);
        await message.reply(`❌ Failed to book slot: ${error.message || error}`);
        if (flow.rejectJob) flow.rejectJob(error);
        else {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      }
      return true;
    }
  }

  return false;
}

/**
 * Handle daily filling messages and commands for Telegram
 * @returns {Promise<boolean>} true if message was handled, false otherwise
 */
async function handleDailyFillingTelegramMessage(msg, bot, enqueueOrReplyTg) {
  const chatId = String(msg && msg.chat && msg.chat.id || '').trim();
  const text = String((msg && msg.text) || '').trim();

  // 1. Session Resumption
  const dlRenewalSessions = getDlRenewalSessions();
  if (dlRenewalSessions.has(chatId) && !text.startsWith('/dlrenewal')) {
    const flow = dlRenewalSessions.get(chatId);
    const otpCode = text.trim();
    if (otpCode.length > 0 && otpCode.length <= 8) {
      dlRenewalSessions.delete(chatId);
      await bot.sendMessage(chatId, '⏳ OTP received. Filling Self-Declaration Form 1 popup and submitting DL Renewal...');
      try {
        const slipPath = await dlRenewalService.submitDLRenewalOTP(flow.browser, flow.context, flow.page, otpCode);
        await bot.sendDocument(chatId, slipPath, { caption: '✅ DL Renewal Successful! Here is your acknowledgement reference slip.' });
        cleanupFile(slipPath);
        if (flow.resolveJob) flow.resolveJob({ ok: true, slipPath });
      } catch (error) {
        await bot.sendMessage(chatId, `❌ DL Renewal failed: ${error.message || error}`);
        if (flow.rejectJob) flow.rejectJob(error);
        else {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      }
      return true;
    }
  }

  const applyDlSessions = getApplyDlSessions();
  if (applyDlSessions.has(chatId) && !text.startsWith('/applydl')) {
    const flow = applyDlSessions.get(chatId);
    const otpCode = text.trim();
    if (otpCode.length > 0 && otpCode.length <= 8) {
      applyDlSessions.delete(chatId);
      await bot.sendMessage(chatId, '⏳ OTP received. Booking class of vehicles, completing Self-Declaration Form 1, and finalising DL application...');
      try {
        const details = await applyDlService.submitApplyDLOTP(flow.browser, flow.context, flow.page, otpCode);
        await bot.sendMessage(chatId, `✅ DL Application Submitted Successfully!\n📝 Application Details: ${details.extractedText}`);
        if (flow.resolveJob) flow.resolveJob({ ok: true, details });
      } catch (error) {
        await bot.sendMessage(chatId, `❌ DL Application failed: ${error.message || error}`);
        if (flow.rejectJob) flow.rejectJob(error);
        else {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      }
      return true;
    }
  }

  const paymentSessions = getPaymentSessions();
  if (paymentSessions.has(chatId) && !text.startsWith('/payfee')) {
    if (/^paid$/i.test(text)) {
      const flow = paymentSessions.get(chatId);
      paymentSessions.delete(chatId);
      await bot.sendMessage(chatId, '⏳ Payment marked as paid. Waiting for portal redirect and downloading receipt...');
      try {
        const receiptPath = await paymentService.confirmPayment(flow.browser, flow.context, flow.page, flow.appNo);
        await bot.sendDocument(chatId, receiptPath, { caption: `✅ Payment receipt downloaded successfully for Application No: ${flow.appNo}.` });
        cleanupFile(receiptPath);
        if (flow.resolveJob) flow.resolveJob({ ok: true, receiptPath });
      } catch (error) {
        await bot.sendMessage(chatId, `❌ Failed to retrieve payment receipt: ${error.message || error}`);
        if (flow.rejectJob) flow.rejectJob(error);
        else {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      }
      return true;
    }
  }

  const slotBookingSessions = getSlotBookingSessions();
  if (slotBookingSessions.has(chatId) && !text.startsWith('/bookslot')) {
    const flow = slotBookingSessions.get(chatId);
    if (flow.waitingForOtp) {
      const otpCode = text.trim();
      if (otpCode.length > 0 && otpCode.length <= 8) {
        slotBookingSessions.delete(chatId);
        await bot.sendMessage(chatId, '⏳ Submitting slot booking OTP and generating confirmation...');
        try {
          const docPath = await slotBookingService.confirmSlotBookingOTP(flow.browser, flow.context, flow.page, otpCode);
          await bot.sendDocument(chatId, docPath, { caption: '🎉 Slot Booked Successfully! Here is your booking confirmation slip.' });
          cleanupFile(docPath);
          if (flow.resolveJob) flow.resolveJob({ ok: true, docPath });
        } catch (error) {
          await bot.sendMessage(chatId, `❌ Booking OTP verification failed: ${error.message || error}`);
          if (flow.rejectJob) flow.rejectJob(error);
          else {
            if (flow.context) await flow.context.close().catch(() => {});
            if (flow.browser) await flow.browser.close().catch(() => {});
          }
        }
        return true;
      }
    } else {
      const choice = text.trim();
      await bot.sendMessage(chatId, '⏳ Caching slot date, triggering booking SMS OTP...');
      try {
        if (/^auto$/i.test(choice)) {
          await slotBookingService.bookPreferredSlot(flow.context, flow.page, null, null);
        } else {
          await slotBookingService.bookPreferredSlot(flow.context, flow.page, choice, null);
        }
        flow.waitingForOtp = true;
        await bot.sendMessage(chatId, '🔐 SMS OTP has been sent for booking confirmation. Please reply with the OTP code.');
      } catch (error) {
        slotBookingSessions.delete(chatId);
        await bot.sendMessage(chatId, `❌ Failed to book slot: ${error.message || error}`);
        if (flow.rejectJob) flow.rejectJob(error);
        else {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      }
      return true;
    }
  }

  return false;
}

module.exports = {
  handleDailyFillingWhatsAppMessage,
  handleDailyFillingTelegramMessage
};
