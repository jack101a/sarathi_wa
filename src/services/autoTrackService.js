const cron = require('node-cron');
const { getTrackingSnapshot } = require('./trackingSnapshotService');
const { parseStatusDetails } = require('./statusService');
const { getAckSnapshot } = require('./ackService');
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
const initialCheckTimers = new Map();

const STAGE_ICONS = {
  scrutiny: '\u231b',
  approval: '\ud83d\udcdd',
  dispatched: '\ud83d\udcec',
  done: '\u2705',
  pending: '\u26a0\ufe0f',
};

function isWithinTrackingWindow() {
  // Only allow auto-tracking between 6 PM (18:00) and 6 AM (06:00)
  const hour = new Date().getHours(); // local time, 0–23
  const allowed = hour >= 18 || hour < 6;
  if (!allowed) {
    console.log('[autoTrack] Outside tracking window (6 PM - 6 AM), skipping.');
  }
  return allowed;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const m = text.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function cleanServiceName(value) {
  return String(value || '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function escapeBold(value) {
  return String(value || '').replace(/\*/g, '');
}

function buildTrackingSignature(snapshot) {
  const details = snapshot.details || parseStatusDetails(snapshot.html);
  return JSON.stringify({
    kind: details.kind || '',
    stage: details.stage || '',
    message: details.message || '',
    approvedAction: details.approvedAction || '',
    approvedOn: details.approvedOn || '',
    transaction: details.transaction || '',
    counter: details.counter || '',
    dlNumber: details.dlNumber || '',
    trackerNo: details.trackerNo || '',
    completedActions: details.completedActions || [],
    furtherActions: details.furtherActions || [],
  });
}

function resolveWhatsAppNotificationTargets() {
  const updateGroupId = String(CONFIG.AUTO_TRACK.UPDATE_CHAT_ID || '').trim();
  return updateGroupId ? [updateGroupId] : [];
}

function deriveAutoTrackStageState(snapshot) {
  const details = snapshot.details || parseStatusDetails(snapshot.html);
  const statusText = [
    details.kind,
    details.stage,
    details.message,
    details.approvedAction,
    details.transaction,
  ].map((value) => String(value || '').toUpperCase()).join(' ');

  const dispatchedDone = details.kind === 'dispatched' || statusText.includes('DISPATCH');
  const approvalDone = dispatchedDone
    || details.kind === 'approved'
    || statusText.includes('PRINTING OF DL')
    || statusText.includes('PRINTING OF LL')
    || statusText.includes('FORM 7')
    || statusText.includes('CARD');
  const scrutinyDone = approvalDone
    || (Boolean(details.stage) && !String(details.stage).toUpperCase().includes('SCRUTINY'));

  return {
    scrutinyDone,
    approvalDone,
    dispatchedDone,
  };
}

function deriveSarathiTimeline(details = {}) {
  const completed = Array.isArray(details.completedActions) ? details.completedActions : [];
  const further = Array.isArray(details.furtherActions) ? details.furtherActions : [];
  const scrutinyRow = completed.find((r) => String(r.actionName || '').toUpperCase().includes('SCRUTINY'));
  const approvalRow = completed.find((r) => String(r.actionName || '').toUpperCase().includes('APPROVAL'));
  const dispatchRow = completed.find((r) => String(r.actionName || '').toUpperCase().includes('DISPATCH'));
  const pendingDispatch = further.find((r) => String(r.actionName || '').toUpperCase().includes('DISPATCH'));

  return {
    scrutinyAt: normalizeDate(scrutinyRow && scrutinyRow.processedOn),
    approvalAt: normalizeDate(approvalRow && approvalRow.processedOn),
    dispatchedAt: normalizeDate(dispatchRow && dispatchRow.processedOn),
    hasPendingDispatch: Boolean(pendingDispatch),
  };
}

function buildStatusCaption(entry, snapshot) {
  const label = String(entry.tag || '').trim();
  const stageState = deriveAutoTrackStageState(snapshot);

  const lines = [
    `App. No: ${entry.appNo}`,
    '',
    label ? `*(${escapeBold(label)})*` : null,
    label ? '' : null,
    `${STAGE_ICONS.scrutiny} Scrutiny  ${stageState.scrutinyDone ? STAGE_ICONS.done : STAGE_ICONS.pending}`,
    `${STAGE_ICONS.approval}Approval ${stageState.approvalDone ? STAGE_ICONS.done : STAGE_ICONS.pending}`,
    `${STAGE_ICONS.dispatched}Dispatched ${stageState.dispatchedDone ? STAGE_ICONS.done : STAGE_ICONS.pending}`,
  ].filter((item) => item !== null);

  return lines.join('\n').trim();
}

async function notifyTrackedApplication(entry, snapshot) {
  if (entry.transport === 'whatsapp') {
    const targets = resolveWhatsAppNotificationTargets();
    for (const targetChatId of targets) {
      await sendTrackingSnapshot(entry, snapshot, targetChatId);
    }
    return true;
  }

  return sendTrackingSnapshot(entry, snapshot, entry.chatId);
}

async function sendTrackingSnapshot(entry, snapshot, targetChatId = entry.chatId) {
  const caption = buildStatusCaption(entry, snapshot);
  const filename = `status_${entry.appNo}.jpg`;

  if (entry.transport === 'whatsapp') {
    return sendWhatsAppImage(targetChatId, snapshot.buffer, filename, caption);
  }

  if (entry.transport === 'telegram') {
    return sendTelegramPhoto(targetChatId, snapshot.buffer, filename, caption);
  }

  throw new Error(`Unsupported transport: ${entry.transport}`);
}

async function checkTrackedEntry(entry) {
  const missingIdentity = !String(entry.applicantName || '').trim() || !String(entry.applicationDate || '').trim();
  const canTryAck = Boolean(String(entry.dob || '').trim()) && missingIdentity;
  let snapshot;
  try {
    snapshot = await getTrackingSnapshot(entry.appNo, entry.dob, {
      keepFile: false,
      filename: `tracked_status_${entry.appNo}_${Date.now()}.jpg`,
      skipAck: !canTryAck,
    });
  } catch (error) {
    if (!canTryAck) {
      throw error;
    }
    // Ack fetch failed for this run; continue with status-only so refresh does not fail.
    snapshot = await getTrackingSnapshot(entry.appNo, entry.dob, {
      keepFile: false,
      filename: `tracked_status_${entry.appNo}_${Date.now()}.jpg`,
      skipAck: true,
    });
  }
  const details = snapshot.details || parseStatusDetails(snapshot.html);
  const timeline = deriveSarathiTimeline(details);
  const serviceName = cleanServiceName(
    (snapshot.ackDetails && snapshot.ackDetails.serviceRequested) || details.transaction || ''
  );
  const applicantName = String((snapshot.ackDetails && snapshot.ackDetails.name) || entry.tag || '').trim();
  const applicationDate = String((snapshot.ackDetails && snapshot.ackDetails.applicationDate) || '').trim();
  const signature = buildTrackingSignature(snapshot);
  const hasChanged = signature !== String(entry.lastSnapshot || '');
  const updates = {
    lastStage: details.stage || entry.lastStage || '',
    lastSnapshot: signature,
    serviceName: serviceName || entry.serviceName || '',
    applicantName: applicantName || entry.applicantName || '',
    applicationDate: applicationDate || entry.applicationDate || '',
    scrutinyAt: timeline.scrutinyAt || entry.scrutinyAt || '',
    approvalAt: timeline.approvalAt || entry.approvalAt || normalizeDate(details.approvedOn) || '',
    dispatchedAt: timeline.dispatchedAt || entry.dispatchedAt || '',
  };

  if (details.kind === 'dispatched') {
    if (hasChanged) {
      await notifyTrackedApplication(entry, snapshot);
    }
    removeTrackedApplication(entry);
    return {
      snapshot,
      details,
      notified: hasChanged,
      removed: true,
    };
  }

  if (hasChanged) {
    await notifyTrackedApplication(entry, snapshot);
    updateTrackedApplication(entry, updates);
    return {
      snapshot,
      details,
      notified: true,
    };
  }

  if (
    (!entry.applicantName && updates.applicantName) ||
    (!entry.serviceName && updates.serviceName) ||
    (!entry.applicationDate && updates.applicationDate) ||
    (!entry.scrutinyAt && updates.scrutinyAt) ||
    (!entry.approvalAt && updates.approvalAt) ||
    (!entry.dispatchedAt && updates.dispatchedAt) ||
    String(entry.lastSnapshot || '') !== signature
  ) {
    updateTrackedApplication(entry, updates);
  }

  return {
    snapshot,
    details,
    notified: false,
  };
}

async function enrichTrackedApplicationFromAck(entry) {
  const appNo = String(entry && entry.appNo || '').trim();
  const dob = String(entry && entry.dob || '').trim();
  if (!appNo || !dob) {
    return { enriched: false, reason: 'MISSING_INPUT' };
  }

  const ackSnapshot = await getAckSnapshot(appNo, dob, {
    keepFile: false,
    filename: `ack_metadata_${appNo}_${Date.now()}.jpg`,
  });
  const ackDetails = ackSnapshot.ackDetails || {};
  const applicantName = String(ackDetails.name || '').trim();
  const serviceName = cleanServiceName(ackDetails.serviceRequested || '');
  const applicationDate = String(ackDetails.applicationDate || '').trim();
  if (!applicantName && !serviceName && !applicationDate) {
    return { enriched: false, reason: 'NO_ACK_DETAILS' };
  }

  const result = updateTrackedApplication(entry, {
    applicantName: applicantName || entry.applicantName || entry.tag || '',
    serviceName: serviceName || entry.serviceName || '',
    applicationDate: applicationDate || entry.applicationDate || '',
  });

  return {
    enriched: Boolean(result.updated),
    applicantName,
    serviceName,
    applicationDate,
  };
}

function scheduleInitialCheck(entry) {
  const key = `${entry.transport}:${entry.chatId}:${entry.appNo}`;
  const existingTimer = initialCheckTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const delayMs = randomBetween(30 * 1000, 60 * 1000);
  const timeoutId = setTimeout(async () => {
    initialCheckTimers.delete(key);
    try {
      await checkTrackedEntry(entry);
    } catch (error) {
      console.error(`Initial auto-track check failed for ${entry.appNo}: ${error.message}`);
    }
  }, delayMs);

  initialCheckTimers.set(key, timeoutId);
}

async function refreshTrackedApplications(chatId, transport = 'whatsapp') {
  const entries = readTrackedApplications().filter(
    (entry) =>
      entry.transport === String(transport || 'whatsapp').trim().toLowerCase() &&
      String(entry.chatId) === String(chatId)
  );

  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) {
      await sleep(randomBetween(5 * 1000, 10 * 1000));
    }

    try {
      await checkTrackedEntry(entries[index]);
    } catch (error) {
      console.error(`Refresh track failed for ${entries[index].appNo}: ${error.message}`);
    }
  }

  return entries.length;
}

async function checkTrackedApplications() {
  if (autoTrackRunning) {
    return;
  }

  if (!isWithinTrackingWindow()) {
    return;
  }

  autoTrackRunning = true;

  try {
    const trackedApplications = readTrackedApplications();
    const BATCH_SIZE = 3;

    for (let i = 0; i < trackedApplications.length; i += BATCH_SIZE) {
      const batch = trackedApplications.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(async (entry) => {
        try {
          await checkTrackedEntry(entry);
        } catch (error) {
          console.error(`Auto-track check failed for ${entry.appNo}: ${error.message}`);
        }
      }));
      // Stagger between batches to avoid hammering the API
      if (i + BATCH_SIZE < trackedApplications.length) {
        await sleep(randomBetween(3000, 6000));
      }
    }
  } finally {
    autoTrackRunning = false;
  }
}

function addAutoTrack(entry) {
  const result = upsertTrackedApplication(entry);

  if (result.created) {
    scheduleInitialCheck({
      ...entry,
      appNo: String(entry.appNo || '').trim(),
      chatId: String(entry.chatId || '').trim(),
      transport: String(entry.transport || '').trim().toLowerCase(),
      tag: String(entry.tag || '').trim(),
      dob: String(entry.dob || '').trim(),
    });
  }

  return result;
}

function removeAutoTrack(entry) {
  const key = [
    String(entry.transport || '').trim().toLowerCase(),
    String(entry.chatId || '').trim(),
    String(entry.appNo || '').trim(),
  ].join(':');
  const timer = initialCheckTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    initialCheckTimers.delete(key);
  }
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
  enrichTrackedApplicationFromAck,
  startAutoTrackScheduler,
  buildStatusCaption,
  buildTrackingSignature,
  resolveWhatsAppNotificationTargets,
  refreshTrackedApplications,
};
