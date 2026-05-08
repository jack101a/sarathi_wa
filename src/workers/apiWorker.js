const fs = require('fs');
const { apiQueue } = require('../core/jobQueue');
const chatNotifier = require('../services/chatNotifier');
const { getTrackingSnapshot } = require('../services/trackingSnapshotService');
const formService = require('../services/formService');
const formsetService = require('../services/formsetService');
const ackService = require('../services/ackService');
const vahanService = require('../services/vahanService');
const imageGeneratorService = require('../services/imageGeneratorService');
const autoTrackService = require('../services/autoTrackService');
const { addAutoTrack, removeAutoTrack, readTrackedApplications } = require('../services/autoTrackService');
const { addTrack: addVahanTrack } = require('../services/vahanService');
const { refreshAllTrackedApplications, removeVahanTrackEverywhere, enforceTrackingLimit } = require('../services/trackingControlService');
function makeVahanClient(transport, chatId) {
  return {
    sendText: async (cid, text) => {
      if (transport === 'telegram') return chatNotifier.sendTelegramMessage(cid, text);
      return chatNotifier.sendWhatsAppText(cid, text);
    },
    sendImage: async (cid, imagePath, caption) => {
      const buf = fs.readFileSync(imagePath);
      const name = String(imagePath).split(/[\\/]/).pop();
      if (transport === 'telegram') return chatNotifier.sendTelegramPhoto(cid, buf, name, caption);
      return chatNotifier.sendWhatsAppImage(cid, buf, name, caption);
    },
  };
}

function cleanup(p) { if (p && fs.existsSync(p)) fs.unlinkSync(p); }
async function sendText(t, c, x) { return t === 'telegram' ? chatNotifier.sendTelegramMessage(c, x) : chatNotifier.sendWhatsAppText(c, x); }
async function sendImageFile(t, c, p, cap = '') { const b = fs.readFileSync(p); const n = p.split(/[\\/]/).pop(); return t === 'telegram' ? chatNotifier.sendTelegramPhoto(c, b, n, cap, 'image/png') : chatNotifier.sendWhatsAppMedia(c, b, 'image/png', n, cap); }
async function sendPdfFile(t, c, p, cap = '') { const b = fs.readFileSync(p); const n = p.split(/[\\/]/).pop(); return t === 'telegram' ? chatNotifier.sendTelegramDocument(c, b, n, cap, 'application/pdf') : chatNotifier.sendWhatsAppMedia(c, b, 'application/pdf', n, cap); }
async function refreshUserTrackedData(chatId, transport) {
  try {
    await autoTrackService.refreshTrackedApplications(chatId, transport);
  } catch (_) {}
  try {
    await vahanService.refreshTrackedApplications(chatId, transport);
  } catch (_) {}
}

apiQueue.process(async (job) => {
 const payload = JSON.parse(job.payload_json || '{}'); const transport = job.transport || 'whatsapp'; const chatId = job.chat_id || payload.chatId;
  if (job.command === 'track') {
    const storedEntry = readTrackedApplications().find(
      (e) => e.appNo === String(payload.appNo || '').trim() && String(e.chatId) === String(chatId)
    );
    const skipAck = Boolean(storedEntry && String(storedEntry.applicantName || '').trim());
    const s = await getTrackingSnapshot(payload.appNo, payload.dob || '', {
      keepFile: true,
      filename: `Track_${payload.appNo}.jpg`,
      skipAck
    });
    const p = s.filePath;
    await sendImageFile(transport, chatId, p);
    cleanup(p);
    return { ok: true };
  }
 if (['form1','form1a','form2'].includes(job.command)) { const p = await formService.downloadForm(payload.appNo, payload.dob, job.command); await sendPdfFile(transport, chatId, p); cleanup(p); return { ok: true }; }
 if (job.command === 'formset') { const r = await formsetService.getFormset(payload.appNo, payload.dob); if (transport === 'telegram') await chatNotifier.sendTelegramDocument(chatId, r.buffer, r.filename, '', 'application/pdf'); else await chatNotifier.sendWhatsAppMedia(chatId, r.buffer, 'application/pdf', r.filename, ''); return { ok: true }; }
 if (job.command === 'appl_image') { const p = await ackService.getAckImage(payload.appNo, payload.dob); await sendImageFile(transport, chatId, p); cleanup(p); return { ok: true }; }
 if (job.command === 'appl_pdf') { const p = await ackService.getAckPDF(payload.appNo, payload.dob); await sendPdfFile(transport, chatId, p); cleanup(p); return { ok: true }; }
 if (job.command === 'track_rc') { const vahanClient = makeVahanClient(transport, chatId); await vahanService.startLookup(vahanClient, chatId, payload.appNo, transport, { expectedVehicleNo: payload.vehicleNo || '' }); return { ok: true }; }
 if (job.command === 'add_track') { const entry = { appNo: payload.appNo, transport, chatId, dob: payload.dob || '', tag: payload.tag || '' }; const r = addAutoTrack(entry); if (r.created && entry.dob) { try { await autoTrackService.enrichTrackedApplicationFromAck(entry); } catch (_) {} } await sendText(transport, chatId, r.created ? `Tracking added for ${payload.appNo}.` : `Tracking already exists for ${payload.appNo}.`); return { ok: true }; }
 if (job.command === 'add_track_rc') { const r = addVahanTrack(chatId, payload.appNo, payload.tag || '', transport, { vehicleNo: payload.vehicleNo || '', applicantName: payload.name || payload.tag || '' }); await sendText(transport, chatId, r.created ? `Vahan tracking added for ${payload.appNo}.` : `Vahan tracking already exists for ${payload.appNo}.`); return { ok: true }; }
 if (job.command === 'remove_track') { const r = removeAutoTrack({ appNo: payload.appNo, transport, chatId }); await sendText(transport, chatId, r.removed ? `Tracking removed for ${payload.appNo}.` : `No tracking found for ${payload.appNo}.`); return { ok: true }; }
 if (job.command === 'remove_track_rc') { const r = removeVahanTrackEverywhere(payload.appNo); await sendText(transport, chatId, r.removed ? `Vahan tracking removed for ${payload.appNo}.` : `No Vahan tracking found for ${payload.appNo}.`); return { ok: true }; }
  if (job.command === 'list_track') { const p = await imageGeneratorService.generateStatusImage(chatId); await sendImageFile(transport, chatId, p); cleanup(p); return { ok: true }; }
 if (job.command === 'refresh_track') { await refreshAllTrackedApplications(); await sendText(transport, chatId, 'Refresh triggered.'); return { ok: true }; }
  if (job.command === 'track_status') { const p = await imageGeneratorService.generateStatusImage(chatId); await sendImageFile(transport, chatId, p); cleanup(p); return { ok: true }; }
 await sendText(transport, chatId, 'Unsupported command for API worker.'); return { ok: false };
});

