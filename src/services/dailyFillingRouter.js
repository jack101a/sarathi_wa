const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config/config');

const dlRenewalService = require('./dlRenewalService');
const applyDlService = require('./applyDlService');
const paymentService = require('./paymentService');
const slotBookingService = require('./slotBookingService');
const mobileUpdateService = require('./mobileUpdateService');
const { normalizeDob } = require('./commandInputService');

const {
  getDlRenewalSessions,
  getApplyDlSessions,
  getPaymentSessions,
  getSlotBookingSessions,
  getMobileUpdateSessions
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
  const mobileUpdateSessions = getMobileUpdateSessions();
  if (mobileUpdateSessions.has(message.from) && !/^\/(?:mobupdate)\b/i.test(normalizedBody)) {
    const flow = mobileUpdateSessions.get(message.from);
    const input = normalizedBody.trim();
    if (input.toLowerCase() === 'stop' || input.toLowerCase() === 'cancel') {
      mobileUpdateSessions.delete(message.from);
      await message.reply('❌ Mobile Update Flow cancelled.');
      if (flow.context) await flow.context.close().catch(() => {});
      if (flow.browser) await flow.browser.close().catch(() => {});
      return true;
    }
    
    if (flow.step === 'aadhaar') {
      if (input.length === 12 && /^\d+$/.test(input)) {
        await message.reply('⏳ Generating Aadhaar OTP...');
        flow.step = 'aadhaar_otp';
        try {
          await mobileUpdateService.generateAadhaarOtp(flow.page, input);
          await message.reply('🔑 Enter Aadhaar OTP:');
        } catch (error) {
          mobileUpdateSessions.delete(message.from);
          await message.reply(`❌ Failed to enter Aadhaar or generate OTP: ${error.message || error}`);
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      } else {
        await message.reply('❌ Invalid Aadhaar number. Please send a valid 12-digit numeric Aadhaar Number or send `stop` to cancel.');
      }
      return true;
    }
    
    if (flow.step === 'aadhaar_otp') {
      if (input.length === 6 && /^\d+$/.test(input)) {
        flow.step = 'target_mobile';
        try {
          await mobileUpdateService.authenticateAadhaar(flow.page, input);
          await message.reply('✅ Aadhaar verified. Send new mobile number:');
        } catch (error) {
          mobileUpdateSessions.delete(message.from);
          await message.reply(`❌ e-KYC Verification failed: ${error.message || error}`);
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      } else {
        await message.reply('❌ Invalid OTP format. Please send the 6-digit Aadhaar OTP.');
      }
      return true;
    }

    if (flow.step === 'target_mobile') {
      if (input.length === 10 && /^\d+$/.test(input)) {
        await message.reply('⏳ Sending Mobile OTP...');
        flow.step = 'mobile_otp';
        flow.targetMobile = input;
        try {
          await flow.page.evaluate(async (newMob) => {
            const baseUrl = "https://sarathi.parivahan.gov.in/sarathiservice";
            await fetch(`${baseUrl}/checkMobCount.do`, {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "x-requested-with": "XMLHttpRequest"
                },
                body: new URLSearchParams({ MobNum: newMob }),
                credentials: "include" 
            });
            let timestamp = Date.now();
            await fetch(`${baseUrl}/sendOTPInMobNumUpd.do?newMobNum=${newMob}&_=${timestamp}`, {
                method: "GET",
                headers: { "x-requested-with": "XMLHttpRequest" },
                credentials: "include"
            });
          }, input);

          await message.reply('🔑 Enter Mobile OTP:');
        } catch (error) {
          mobileUpdateSessions.delete(message.from);
          await message.reply(`❌ Failed to trigger Mobile OTP: ${error.message || error}`);
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      } else {
        await message.reply('❌ Invalid mobile number. Please send a valid 10-digit numeric Mobile Number.');
      }
      return true;
    }

    if (flow.step === 'mobile_otp') {
      if (input.length === 6 && /^\d+$/.test(input)) {
        mobileUpdateSessions.delete(message.from);
        await message.reply('⏳ Updating...');
        try {
          const result = await mobileUpdateService.executeBypassScript(flow.page, flow.targetMobile, input);
          if (result.screenshotPath) {
            const media = MessageMedia.fromFilePath(result.screenshotPath);
            const caption = result.success 
              ? `🎉 Updated to ${flow.targetMobile}!` 
              : `❌ Update may have failed. Check preview.`;
            await client.sendMessage(message.from, media, { caption });
            cleanupFile(result.screenshotPath);
            if (result.success) {
              if (flow.resolveJob) flow.resolveJob({ ok: true });
            } else {
              if (flow.rejectJob) flow.rejectJob(new Error('Update failed on portal.'));
            }
          } else {
            await message.reply('❌ Mobile update failed.');
            if (flow.rejectJob) flow.rejectJob(new Error('Mobile update failed. No confirmation page screenshot.'));
          }
        } catch (error) {
          await message.reply(`❌ Mobile Update failed: ${error.message || error}`);
          if (flow.rejectJob) flow.rejectJob(error);
        } finally {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      } else {
        await message.reply('❌ Invalid OTP format. Please send the 6-digit Mobile OTP.');
      }
      return true;
    }
  }

  const dlRenewalSessions = getDlRenewalSessions();
  if (dlRenewalSessions.has(message.from) && !/^\/(?:dlrenewal|renewal|duplicate|replacement|dlextract|dl)\b/i.test(normalizedBody)) {
    const flow = dlRenewalSessions.get(message.from);
    const otpCode = normalizedBody.trim();
    if (otpCode.length > 0 && otpCode.length <= 8) {
      dlRenewalSessions.delete(message.from);
      
      const serviceType = flow.serviceType || 'RENEWAL OF DL';
      const serviceName = serviceType.replace('OF DL', '').replace('ISSUE OF', '').trim().toLowerCase();
      const formattedServiceName = serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
      
      await message.reply(`⏳ OTP received. Filling Self-Declaration Form 1 popup and submitting DL ${formattedServiceName}...`);
      try {
        const slipPath = await dlRenewalService.submitDLRenewalOTP(flow.browser, flow.context, flow.page, otpCode, flow.serviceType);
        const media = MessageMedia.fromFilePath(slipPath);
        await client.sendMessage(message.from, media, { caption: `✅ DL ${formattedServiceName} Successful! Here is your acknowledgement reference slip.` });
        cleanupFile(slipPath);
        if (flow.resolveJob) flow.resolveJob({ ok: true, slipPath });
      } catch (error) {
        await message.reply(`❌ DL ${formattedServiceName} failed: ${error.message || error}`);
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
  if (applyDlSessions.has(message.from) && !normalizedBody.startsWith('/dlapp')) {
    const flow = applyDlSessions.get(message.from);
    const otpCode = normalizedBody.trim();
    if (otpCode.length > 0 && otpCode.length <= 8) {
      applyDlSessions.delete(message.from);
      await message.reply('⏳ OTP received. Booking class of vehicles, completing Self-Declaration Form 1, and finalising DL application...');
      try {
        const details = await applyDlService.submitApplyDLOTP(flow.browser, flow.context, flow.page, otpCode);
        await message.reply(`✅ DL Application Submitted Successfully!\n📝 Application Details: ${details.extractedText}`);
        if (details.screenshotPath) {
          try {
            const media = MessageMedia.fromFilePath(details.screenshotPath);
            await client.sendMessage(message.from, media, { caption: '📄 Here is your DL Application Acknowledgment Slip.' });
          } catch (e) {
            console.error('Failed to send acknowledgment screenshot to WhatsApp:', e);
          }
          cleanupFile(details.screenshotPath);
        }
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
  const mobileUpdateSessions = getMobileUpdateSessions();
  if (mobileUpdateSessions.has(chatId) && !/^\/(?:mobupdate)\b/i.test(text)) {
    const flow = mobileUpdateSessions.get(chatId);
    const input = text.trim();
    if (input.toLowerCase() === 'stop' || input.toLowerCase() === 'cancel') {
      mobileUpdateSessions.delete(chatId);
      await bot.sendMessage(chatId, '❌ Mobile Update Flow cancelled.');
      if (flow.context) await flow.context.close().catch(() => {});
      if (flow.browser) await flow.browser.close().catch(() => {});
      return true;
    }
    
    if (flow.step === 'aadhaar') {
      if (input.length === 12 && /^\d+$/.test(input)) {
        await bot.sendMessage(chatId, '⏳ Generating Aadhaar OTP...');
        flow.step = 'aadhaar_otp';
        try {
          await mobileUpdateService.generateAadhaarOtp(flow.page, input);
          await bot.sendMessage(chatId, '🔑 Enter Aadhaar OTP:');
        } catch (error) {
          mobileUpdateSessions.delete(chatId);
          await bot.sendMessage(chatId, `❌ Failed to enter Aadhaar or generate OTP: ${error.message || error}`);
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      } else {
        await bot.sendMessage(chatId, '❌ Invalid Aadhaar number. Please send a valid 12-digit numeric Aadhaar Number or send `stop` to cancel.');
      }
      return true;
    }
    
    if (flow.step === 'aadhaar_otp') {
      if (input.length === 6 && /^\d+$/.test(input)) {
        flow.step = 'target_mobile';
        try {
          await mobileUpdateService.authenticateAadhaar(flow.page, input);
          await bot.sendMessage(chatId, '✅ Aadhaar verified. Send new mobile number:');
        } catch (error) {
          mobileUpdateSessions.delete(chatId);
          await bot.sendMessage(chatId, `❌ e-KYC Verification failed: ${error.message || error}`);
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      } else {
        await bot.sendMessage(chatId, '❌ Invalid OTP format. Please send the 6-digit Aadhaar OTP.');
      }
      return true;
    }

    if (flow.step === 'target_mobile') {
      if (input.length === 10 && /^\d+$/.test(input)) {
        await bot.sendMessage(chatId, '⏳ Sending Mobile OTP...');
        flow.step = 'mobile_otp';
        flow.targetMobile = input;
        try {
          await flow.page.evaluate(async (newMob) => {
            const baseUrl = "https://sarathi.parivahan.gov.in/sarathiservice";
            await fetch(`${baseUrl}/checkMobCount.do`, {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "x-requested-with": "XMLHttpRequest"
                },
                body: new URLSearchParams({ MobNum: newMob }),
                credentials: "include" 
            });
            let timestamp = Date.now();
            await fetch(`${baseUrl}/sendOTPInMobNumUpd.do?newMobNum=${newMob}&_=${timestamp}`, {
                method: "GET",
                headers: { "x-requested-with": "XMLHttpRequest" },
                credentials: "include"
            });
          }, input);

          await bot.sendMessage(chatId, '🔑 Enter Mobile OTP:');
        } catch (error) {
          mobileUpdateSessions.delete(chatId);
          await bot.sendMessage(chatId, `❌ Failed to trigger Mobile OTP: ${error.message || error}`);
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      } else {
        await bot.sendMessage(chatId, '❌ Invalid mobile number. Please send a valid 10-digit numeric Mobile Number.');
      }
      return true;
    }

    if (flow.step === 'mobile_otp') {
      if (input.length === 6 && /^\d+$/.test(input)) {
        mobileUpdateSessions.delete(chatId);
        await bot.sendMessage(chatId, '⏳ Updating...');
        try {
          const result = await mobileUpdateService.executeBypassScript(flow.page, flow.targetMobile, input);
          if (result.screenshotPath) {
            const docBuffer = fs.readFileSync(result.screenshotPath);
            const caption = result.success 
              ? `🎉 Updated to ${flow.targetMobile}!` 
              : `❌ Update may have failed. Check preview.`;
            await bot.sendPhoto(chatId, docBuffer, { caption });
            cleanupFile(result.screenshotPath);
            if (result.success) {
              if (flow.resolveJob) flow.resolveJob({ ok: true });
            } else {
              if (flow.rejectJob) flow.rejectJob(new Error('Update failed on portal.'));
            }
          } else {
            await bot.sendMessage(chatId, '❌ Mobile update failed.');
            if (flow.rejectJob) flow.rejectJob(new Error('Mobile update failed. No confirmation page screenshot.'));
          }
        } catch (error) {
          await bot.sendMessage(chatId, `❌ Mobile Update failed: ${error.message || error}`);
          if (flow.rejectJob) flow.rejectJob(error);
        } finally {
          if (flow.context) await flow.context.close().catch(() => {});
          if (flow.browser) await flow.browser.close().catch(() => {});
        }
      } else {
        await bot.sendMessage(chatId, '❌ Invalid OTP format. Please send the 6-digit Mobile OTP.');
      }
      return true;
    }
  }

  const dlRenewalSessions = getDlRenewalSessions();
  if (dlRenewalSessions.has(chatId) && !/^\/(?:dlrenewal|renewal|duplicate|replacement|dlextract|dl)\b/i.test(text)) {
    const flow = dlRenewalSessions.get(chatId);
    const otpCode = text.trim();
    if (otpCode.length > 0 && otpCode.length <= 8) {
      dlRenewalSessions.delete(chatId);
      
      const serviceType = flow.serviceType || 'RENEWAL OF DL';
      const serviceName = serviceType.replace('OF DL', '').replace('ISSUE OF', '').trim().toLowerCase();
      const formattedServiceName = serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
      
      await bot.sendMessage(chatId, `⏳ OTP received. Filling Self-Declaration Form 1 popup and submitting DL ${formattedServiceName}...`);
      try {
        const slipPath = await dlRenewalService.submitDLRenewalOTP(flow.browser, flow.context, flow.page, otpCode, flow.serviceType);
        await bot.sendDocument(chatId, slipPath, { caption: `✅ DL ${formattedServiceName} Successful! Here is your acknowledgement reference slip.` });
        cleanupFile(slipPath);
        if (flow.resolveJob) flow.resolveJob({ ok: true, slipPath });
      } catch (error) {
        await bot.sendMessage(chatId, `❌ DL ${formattedServiceName} failed: ${error.message || error}`);
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
  if (applyDlSessions.has(chatId) && !text.startsWith('/dlapp')) {
    const flow = applyDlSessions.get(chatId);
    const otpCode = text.trim();
    if (otpCode.length > 0 && otpCode.length <= 8) {
      applyDlSessions.delete(chatId);
      await bot.sendMessage(chatId, '⏳ OTP received. Booking class of vehicles, completing Self-Declaration Form 1, and finalising DL application...');
      try {
        const details = await applyDlService.submitApplyDLOTP(flow.browser, flow.context, flow.page, otpCode);
        await bot.sendMessage(chatId, `✅ DL Application Submitted Successfully!\n📝 Application Details: ${details.extractedText}`);
        if (details.screenshotPath) {
          try {
            await bot.sendPhoto(chatId, details.screenshotPath, { caption: '📄 Here is your DL Application Acknowledgment Slip.' });
          } catch (e) {
            console.error('Failed to send acknowledgment screenshot to Telegram:', e);
          }
          cleanupFile(details.screenshotPath);
        }
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
