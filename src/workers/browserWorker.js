const { browserQueue } = require('../core/jobQueue');
const llPrintService = require('../services/llPrintService');
const llEditService = require('../services/llEditService');
const dlRenewalService = require('../services/dlRenewalService');
const applyDlService = require('../services/applyDlService');
const paymentService = require('../services/paymentService');
const slotBookingService = require('../services/slotBookingService');
const chatNotifier = require('../services/chatNotifier');
const fs = require('fs');

const llprintSessions = new Map();
function getLlprintSessions() { return llprintSessions; }

const lleditSessions = new Map();
function getLleditSessions() { return lleditSessions; }

const dlRenewalSessions = new Map();
function getDlRenewalSessions() { return dlRenewalSessions; }

const applyDlSessions = new Map();
function getApplyDlSessions() { return applyDlSessions; }

const paymentSessions = new Map();
function getPaymentSessions() { return paymentSessions; }

const slotBookingSessions = new Map();
function getSlotBookingSessions() { return slotBookingSessions; }

browserQueue.process(async (job) => {
  const payload = JSON.parse(job.payload_json || '{}');
  const transport = job.transport || 'whatsapp';
  const chatId = job.chat_id || payload.chatId;
  
  if (job.command === 'llprint_start') {
    const { context, page } = await llPrintService.startLLPrintFlow(payload.appNo, payload.dob, payload.mobile);
    llprintSessions.set(String(chatId), { context, page, appNo: payload.appNo, dob: payload.dob, transport });
    if (transport === 'telegram') await chatNotifier.sendTelegramMessage(chatId, 'OTP sent, enter it now.');
    else await chatNotifier.sendWhatsAppText(chatId, 'OTP sent, enter it now.');
    return { ok: true };
  }
  
  if (job.command === 'lledit_start') {
    const { context, page, dynamicData } = await llEditService.startLLEditFlow(payload.appNo, payload.dob, payload.mobile);
    lleditSessions.set(String(chatId), { context, page, targetAppNo: payload.appNo, targetDob: payload.dob, dynamicData, transport });
    if (transport === 'telegram') await chatNotifier.sendTelegramMessage(chatId, 'OTP sent, enter it now.');
    else await chatNotifier.sendWhatsAppText(chatId, 'OTP sent, enter it now.');
    return { ok: true };
  }

  if (job.command === 'dl_renewal_start') {
    const { browser, context, page } = await dlRenewalService.startDLRenewalFlow(payload.dlNo, payload.dob, payload.rtoCode, payload.mobile);
    dlRenewalSessions.set(String(chatId), { browser, context, page, dlNo: payload.dlNo, dob: payload.dob, transport });
    const msg = '🔐 DL Renewal OTP generated. Please reply with the 6-digit OTP code to continue.';
    if (transport === 'telegram') await chatNotifier.sendTelegramMessage(chatId, msg);
    else await chatNotifier.sendWhatsAppText(chatId, msg);
    return { ok: true };
  }

  if (job.command === 'apply_dl_start') {
    const { browser, context, page } = await applyDlService.startApplyDLFlow(payload.llNo, payload.dob, payload.mobile);
    applyDlSessions.set(String(chatId), { browser, context, page, llNo: payload.llNo, dob: payload.dob, transport });
    const msg = '🔐 DL Application OTP generated. Please reply with the 6-digit OTP code to continue.';
    if (transport === 'telegram') await chatNotifier.sendTelegramMessage(chatId, msg);
    else await chatNotifier.sendWhatsAppText(chatId, msg);
    return { ok: true };
  }

  if (job.command === 'pay_fee_start') {
    const { browser, context, page, qrImagePath } = await paymentService.startPaymentFlow(payload.appNo, payload.dob);
    paymentSessions.set(String(chatId), { browser, context, page, appNo: payload.appNo, dob: payload.dob, qrImagePath, transport });
    
    const qrBuffer = fs.readFileSync(qrImagePath);
    const caption = `💸 Scan this QR Code to pay the application fee for Application No: ${payload.appNo}.\n\nOnce paid, please reply with "paid" to download your print receipt.`;
    
    if (transport === 'telegram') {
      await chatNotifier.sendTelegramPhoto(chatId, qrBuffer, 'qr.png', caption);
    } else {
      await chatNotifier.sendWhatsAppImage(chatId, qrBuffer, 'qr.png', caption);
    }
    
    // Clean up temporary screenshot
    if (fs.existsSync(qrImagePath)) fs.unlinkSync(qrImagePath);
    return { ok: true };
  }

  if (job.command === 'slot_booking_start') {
    const { browser, context, page, calendarScreenshotPath } = await slotBookingService.startSlotBookingFlow(payload.appNo, payload.dob);
    slotBookingSessions.set(String(chatId), { browser, context, page, appNo: payload.appNo, dob: payload.dob, calendarScreenshotPath, transport, waitingForOtp: false });
    
    const calendarBuffer = fs.readFileSync(calendarScreenshotPath);
    const caption = `📅 Here are the available slots for Application No: ${payload.appNo}.\n\nReply with "auto" to book the first available green slot, or specify a date like "29" or "YYYY-MM-DD 13:00".`;
    
    if (transport === 'telegram') {
      await chatNotifier.sendTelegramPhoto(chatId, calendarBuffer, 'calendar.png', caption);
    } else {
      await chatNotifier.sendWhatsAppImage(chatId, calendarBuffer, 'calendar.png', caption);
    }
    
    // Clean up temporary screenshot
    if (fs.existsSync(calendarScreenshotPath)) fs.unlinkSync(calendarScreenshotPath);
    return { ok: true };
  }

  if (job.command === 'fee_print_start') {
    const receiptPath = await paymentService.printExistingReceipt(payload.appNo, payload.dob);
    const isPdf = String(receiptPath).toLowerCase().endsWith('.pdf');
    const caption = `✅ Here is your official fee payment receipt for Application No: ${payload.appNo}.`;

    if (isPdf) {
      const pdfBuffer = fs.readFileSync(receiptPath);
      const filename = `Receipt_${payload.appNo}.pdf`;
      if (transport === 'telegram') {
        await chatNotifier.sendTelegramDocument(chatId, pdfBuffer, filename, caption, 'application/pdf');
      } else {
        await chatNotifier.sendWhatsAppMedia(chatId, pdfBuffer, 'application/pdf', filename, caption);
      }
    } else {
      const imgBuffer = fs.readFileSync(receiptPath);
      const filename = `Receipt_${payload.appNo}.png`;
      if (transport === 'telegram') {
        await chatNotifier.sendTelegramPhoto(chatId, imgBuffer, filename, caption, 'image/png');
      } else {
        await chatNotifier.sendWhatsAppMedia(chatId, imgBuffer, 'image/png', filename, caption);
      }
    }

    if (fs.existsSync(receiptPath)) fs.unlinkSync(receiptPath);
    return { ok: true };
  }
  
  throw new Error(`Unsupported browser command: ${job.command}`);
});

module.exports = {
  getLlprintSessions,
  getLleditSessions,
  getDlRenewalSessions,
  getApplyDlSessions,
  getPaymentSessions,
  getSlotBookingSessions
};

