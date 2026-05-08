const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/config');

function getStorePath() {
  return CONFIG.TRACKING.UNIFIED_STORE_PATH;
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
    .filter((item) => item && (item.appNo || item.applicationNumber) && item.chatId && item.transport && item.type)
    .map((item) => ({
      type: String(item.type).trim().toLowerCase(),
      appNo: String(item.appNo || item.applicationNumber).trim(),
      chatId: String(item.chatId).trim(),
      transport: String(item.transport).trim().toLowerCase(),
      createdAt: item.createdAt || new Date().toISOString(),
      lastStage: String(item.lastStage || '').trim(),
      lastSnapshot: String(item.lastSnapshot || '').trim(),
      tag: String(item.tag || '').trim(),
      dob: String(item.dob || '').trim(),
      lastCheckedAt: String(item.lastCheckedAt || '').trim(),
      applicantName: String(item.applicantName || '').trim(),
      serviceName: String(item.serviceName || '').trim(),
      vehicleNumber: String(item.vehicleNumber || '').trim(),
      applicationDate: String(item.applicationDate || '').trim(),
    }));
}

function readEntries() {
  const storePath = getStorePath();

  if (!fs.existsSync(storePath)) {
    const sarathiPath = CONFIG.AUTO_TRACK.STORE_PATH;
    const vahanPath = CONFIG.VAHAN_TRACK.STORE_PATH;
    let unified = [];

    if (fs.existsSync(sarathiPath)) {
      try {
        const raw = fs.readFileSync(sarathiPath, 'utf8');
        if (raw.trim()) {
          const data = JSON.parse(raw);
          if (Array.isArray(data)) {
            unified = unified.concat(data.map(i => ({ ...i, type: 'sarathi' })));
          }
        }
      } catch (e) {
        console.error(`Failed to migrate Sarathi data: ${e.message}`);
      }
    }

    if (fs.existsSync(vahanPath)) {
      try {
        const raw = fs.readFileSync(vahanPath, 'utf8');
        if (raw.trim()) {
          const data = JSON.parse(raw);
          if (Array.isArray(data)) {
            unified = unified.concat(data.map(i => ({ ...i, type: 'vahan' })));
          }
        }
      } catch (e) {
        console.error(`Failed to migrate Vahan data: ${e.message}`);
      }
    }

    if (unified.length > 0) {
      const normalized = normalizeEntries(unified);
      writeEntries(normalized);
      return normalized;
    }
    return [];
  }

  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    if (!raw.trim()) return [];
    return normalizeEntries(JSON.parse(raw));
  } catch (error) {
    console.error(`Failed to read unified store: ${error.message}`);
    return [];
  }
}

function writeEntries(entries) {
  ensureStoreDir();
  const storePath = getStorePath();
  const safeEntries = normalizeEntries(entries);
  
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(safeEntries, null, 2));
  fs.renameSync(tempPath, storePath);
  
  return safeEntries;
}

function addEntry(entry) {
  const entries = readEntries();
  const type = String(entry.type || '').trim().toLowerCase();
  const appNo = String(entry.appNo || entry.applicationNumber || '').trim();
  const chatId = String(entry.chatId || '').trim();
  const transport = String(entry.transport || '').trim().toLowerCase();

  const exists = entries.find(
    (item) => item.type === type && item.appNo === appNo && item.chatId === chatId && item.transport === transport
  );

  if (exists) {
    return { created: false, entry: exists };
  }

  const newEntry = {
    ...entry,
    type,
    appNo,
    chatId,
    transport,
    createdAt: new Date().toISOString(),
    // Preserve any enrichment data passed by the caller; don't overwrite with empty
    lastSnapshot: String(entry.lastSnapshot || '').trim(),
    lastStage: String(entry.lastStage || '').trim(),
    lastCheckedAt: String(entry.lastCheckedAt || '').trim(),
  };

  const next = [...entries, newEntry];
  writeEntries(next);
  return { created: true, entry: newEntry };
}

function removeEntry(query) {
  const entries = readEntries();
  const type = String(query.type || '').trim().toLowerCase();
  const appNo = String(query.appNo || query.applicationNumber || '').trim();
  const chatId = String(query.chatId || '').trim();
  const transport = String(query.transport || '').trim().toLowerCase();

  const next = entries.filter(
    (item) => !(item.type === type && item.appNo === appNo && item.chatId === chatId && item.transport === transport)
  );

  const removed = next.length !== entries.length;
  if (removed) {
    writeEntries(next);
  }

  return { removed };
}

function updateEntry(query, updates = {}) {
  const entries = readEntries();
  const type = String(query.type || '').trim().toLowerCase();
  const appNo = String(query.appNo || query.applicationNumber || '').trim();
  const chatId = String(query.chatId || '').trim();
  const transport = String(query.transport || '').trim().toLowerCase();
  let updated = false;

  const next = entries.map((item) => {
    if (item.type === type && item.appNo === appNo && item.chatId === chatId && item.transport === transport) {
      updated = true;
      return {
        ...item,
        ...updates,
        // Preserve key identifiers
        type: item.type,
        appNo: item.appNo,
        chatId: item.chatId,
        transport: item.transport,
      };
    }
    return item;
  });

  if (updated) {
    writeEntries(next);
  }

  return { updated };
}

module.exports = {
  readEntries,
  writeEntries,
  addEntry,
  removeEntry,
  updateEntry,
};
