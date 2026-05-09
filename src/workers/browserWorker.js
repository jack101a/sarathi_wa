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
    const sessionKey = String(chatId);
    llprintSessions.set(sessionKey, { context, page, appNo: payload.appNo, dob: payload.dob, transport });

    // Auto-timeout after 300 seconds (5 minutes)
    setTimeout(async () => {
      const session = llprintSessions.get(sessionKey);
      // Ensure we only clean up the exact same context to avoid race conditions
      if (session && session.context === context) {
        console.log(`[LLPrint] Session timeout for ${chatId}. Cleaning up...`);
        llprintSessions.delete(sessionKey);
        await llPrintService.closeLLPrintFlow(context);
        
        const timeoutMsg = 'Session timed out (300s). Your OTP is no longer valid. Please start again.';
        if (transport === 'telegram') await chatNotifier.sendTelegramMessage(chatId, timeoutMsg);
        else await chatNotifier.sendWhatsAppText(chatId, timeoutMsg);
      }
    }, 300000);

    if (transport === 'telegram') await chatNotifier.sendTelegramMessage(chatId, 'OTP sent, enter it now.');
    else await chatNotifier.sendWhatsAppText(chatId, 'OTP sent, enter it now.');
    return { ok: true };
  }
  throw new Error(`Unsupported browser command: ${job.command}`);
});
module.exports = { getLlprintSessions };
