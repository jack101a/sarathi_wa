const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/config');

function getStorePath() {
  return CONFIG.AUTO_TRACK.STORE_PATH;
}

function ensureStoreDir() {
  const dir = path.dirname(getStorePath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeEntries(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .filter((item) => item && item.appNo && item.chatId && item.transport)
    .map((item) => ({
      appNo: String(item.appNo).trim(),
      chatId: String(item.chatId).trim(),
      transport: String(item.transport).trim().toLowerCase(),
      createdAt: item.createdAt || new Date().toISOString(),
      lastStage: String(item.lastStage || '').trim(),
      lastSnapshot: String(item.lastSnapshot || '').trim(),
      tag: String(item.tag || '').trim(),
      dob: String(item.dob || '').trim(),
    }));
}

function readTrackedApplications() {
  try {
    const storePath = getStorePath();
    if (!fs.existsSync(storePath)) {
      return [];
    }

    const raw = fs.readFileSync(storePath, 'utf8');
    if (!raw.trim()) {
      return [];
    }

    return normalizeEntries(JSON.parse(raw));
  } catch (error) {
    console.error(`Failed to read tracked applications: ${error.message}`);
    return [];
  }
}

function writeTrackedApplications(entries) {
  ensureStoreDir();

  const safeEntries = normalizeEntries(entries);
  const storePath = getStorePath();
  const tempPath = `${storePath}.tmp`;

  fs.writeFileSync(tempPath, JSON.stringify(safeEntries, null, 2));
  fs.renameSync(tempPath, storePath);

  return safeEntries;
}

function upsertTrackedApplication(entry) {
  const appNo = String(entry.appNo || '').trim();
  const chatId = String(entry.chatId || '').trim();
  const transport = String(entry.transport || '').trim().toLowerCase();
  const tag = String(entry.tag || '').trim();
  const dob = String(entry.dob || '').trim();

  if (!appNo || !chatId || !transport) {
    throw new Error('Application number, chat ID, and transport are required.');
  }

  const existing = readTrackedApplications();
  const duplicate = existing.find(
    (item) => item.appNo === appNo && item.chatId === chatId && item.transport === transport
  );

  if (duplicate) {
    return {
      created: false,
      entries: existing,
    };
  }

  const next = [
    ...existing,
    {
      appNo,
      chatId,
      transport,
      tag,
      dob,
      createdAt: new Date().toISOString(),
      lastStage: '',
    },
  ];

  return {
    created: true,
    entries: writeTrackedApplications(next),
  };
}

function removeTrackedApplication(entry) {
  const appNo = String(entry.appNo || '').trim();
  const chatId = String(entry.chatId || '').trim();
  const transport = String(entry.transport || '').trim().toLowerCase();

  const existing = readTrackedApplications();
  const next = existing.filter(
    (item) => !(item.appNo === appNo && item.chatId === chatId && item.transport === transport)
  );

  const removed = next.length !== existing.length;

  if (removed) {
    writeTrackedApplications(next);
  }

  return {
    removed,
    entries: removed ? next : existing,
  };
}

function updateTrackedApplication(entry, updates = {}) {
  const appNo = String(entry.appNo || '').trim();
  const chatId = String(entry.chatId || '').trim();
  const transport = String(entry.transport || '').trim().toLowerCase();

  const existing = readTrackedApplications();
  let updated = false;

  const next = existing.map((item) => {
    if (item.appNo === appNo && item.chatId === chatId && item.transport === transport) {
      updated = true;
      return {
        ...item,
        ...updates,
        tag: typeof updates.tag === 'undefined'
          ? item.tag || ''
          : String(updates.tag || '').trim(),
        dob: typeof updates.dob === 'undefined'
          ? item.dob || ''
          : String(updates.dob || '').trim(),
        lastSnapshot: typeof updates.lastSnapshot === 'undefined'
          ? item.lastSnapshot || ''
          : String(updates.lastSnapshot || '').trim(),
        lastStage: typeof updates.lastStage === 'undefined'
          ? item.lastStage || ''
          : String(updates.lastStage || '').trim(),
      };
    }

    return item;
  });

  if (!updated) {
    return {
      updated: false,
      entries: existing,
    };
  }

  return {
    updated: true,
    entries: writeTrackedApplications(next),
  };
}

module.exports = {
  readTrackedApplications,
  writeTrackedApplications,
  upsertTrackedApplication,
  removeTrackedApplication,
  updateTrackedApplication,
};
