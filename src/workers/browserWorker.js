const { browserQueue } = require('../core/jobQueue');
const llPrintService = require('../services/llPrintService');
const chatNotifier = require('../services/chatNotifier');
const llprintSessions = new Map();
function getLlprintSessions() { return llprintSessions; }
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
  throw new Error(`Unsupported browser command: ${job.command}`);
});
module.exports = { getLlprintSessions };
