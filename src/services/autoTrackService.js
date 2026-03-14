const cron = require('node-cron');
const { getStatusSnapshot, parseStatusDetails } = require('./statusService');
const {
  readTrackedApplications,
  upsertTrackedApplication,
  removeTrackedApplication,
  updateTrackedApplication,
} = require('./autoTrackStore');
const { sendWhatsAppImage, sendTelegramPhoto } = require('./chatNotifier');
const CONFIG = require('../config/config');

let autoTrackJob = null;
let autoTrackRunning = false;

async function notifyTrackedApplication(entry, snapshot) {
  const details = parseStatusDetails(snapshot.html);
  const label = entry.tag || entry.appNo;
  const caption =
    details.kind === 'dispatched'
      ? [
          `Application ${label} is approved and dispatched.`,
          details.dlNumber ? `DL No: ${details.dlNumber}` : null,
          details.trackerNo ? `Tracker No: ${details.trackerNo}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : details.kind === 'approved'
        ? [
            `Application ${label} is approved.`,
            details.approvedAction ? `Action: ${details.approvedAction}` : null,
            details.approvedOn ? `Processed On: ${details.approvedOn}` : null,
          ]
            .filter(Boolean)
            .join('\n')
      : `Status update for application ${label}: ${details.stage || details.message || 'updated'}.`;
  const filename = `status_${entry.appNo}.jpg`;

  if (entry.transport === 'whatsapp') {
    return sendWhatsAppImage(entry.chatId, snapshot.buffer, filename, caption);
  }

  if (entry.transport === 'telegram') {
    return sendTelegramPhoto(entry.chatId, snapshot.buffer, filename, caption);
  }

  throw new Error(`Unsupported transport: ${entry.transport}`);
}

async function checkTrackedApplications() {
  if (autoTrackRunning) {
    return;
  }

  autoTrackRunning = true;

  try {
    const trackedApplications = readTrackedApplications();

    for (const entry of trackedApplications) {
      try {
        const snapshot = await getStatusSnapshot(entry.appNo, {
          keepFile: false,
          filename: `tracked_status_${entry.appNo}_${Date.now()}.jpg`,
        });
        const details = parseStatusDetails(snapshot.html);

        if (details.kind === 'approved' || details.kind === 'dispatched') {
          await notifyTrackedApplication(entry, snapshot);
          removeTrackedApplication(entry);
          continue;
        }

        if (details.kind === 'approval-stage') {
          if (details.stage && details.stage !== (entry.lastStage || '')) {
            await notifyTrackedApplication(entry, snapshot);
            updateTrackedApplication(entry, { lastStage: details.stage });
          }
          continue;
        }

        if (details.kind === 'pending-counter' || details.kind === 'pending') {
          continue;
        }
      } catch (error) {
        console.error(`Auto-track check failed for ${entry.appNo}: ${error.message}`);
      }
    }
  } finally {
    autoTrackRunning = false;
  }
}

function addAutoTrack(entry) {
  return upsertTrackedApplication(entry);
}

function removeAutoTrack(entry) {
  return removeTrackedApplication(entry);
}

function startAutoTrackScheduler() {
  if (autoTrackJob) {
    return autoTrackJob;
  }

  autoTrackJob = cron.schedule(CONFIG.AUTO_TRACK.CRON, () => {
    checkTrackedApplications().catch((error) => {
      console.error(`Auto-track scheduler failed: ${error.message}`);
    });
  });

  return autoTrackJob;
}

module.exports = {
  addAutoTrack,
  removeAutoTrack,
  readTrackedApplications,
  checkTrackedApplications,
  startAutoTrackScheduler,
};
