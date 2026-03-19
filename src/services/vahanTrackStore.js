const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/config');

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStorePath() {
  return CONFIG.VAHAN_TRACK.STORE_PATH;
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
    .filter((item) => item && item.chatId && item.applicationNumber)
    .map((item) => ({
      transport: normalizeText(item.transport || 'whatsapp'),
      chatId: normalizeText(item.chatId),
      applicationNumber: normalizeText(item.applicationNumber),
      tag: normalizeText(item.tag),
      createdAt: item.createdAt || new Date().toISOString(),
      lastSnapshot: normalizeText(item.lastSnapshot),
      lastCheckedAt: item.lastCheckedAt || '',
    }));
}

function readEntries() {
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
    return [];
  }
}

function writeEntries(entries) {
  const storePath = getStorePath();
  ensureStoreDir();

  const safeEntries = normalizeEntries(entries);

  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(safeEntries, null, 2), 'utf8');
  fs.renameSync(tempPath, storePath);
  return safeEntries;
}

function listEntries(transport, chatId) {
  return readEntries().filter(
    (item) =>
      item.transport === normalizeText(transport || 'whatsapp') &&
      item.chatId === normalizeText(chatId)
  );
}

function addEntry({ transport, chatId, applicationNumber, tag }) {
  const entries = readEntries();
  const normalizedTransport = normalizeText(transport || 'whatsapp');
  const normalizedChatId = normalizeText(chatId);
  const normalizedApplicationNumber = normalizeText(applicationNumber);
  const normalizedTag = normalizeText(tag);

  const exists = entries.find(
    (item) =>
      item.transport === normalizedTransport &&
      item.chatId === normalizedChatId &&
      item.applicationNumber === normalizedApplicationNumber
  );

  if (exists) {
    return { created: false, entry: exists };
  }

  const entry = {
    transport: normalizedTransport,
    chatId: normalizedChatId,
    applicationNumber: normalizedApplicationNumber,
    tag: normalizedTag,
    createdAt: new Date().toISOString(),
    lastSnapshot: '',
    lastCheckedAt: '',
  };

  writeEntries([...entries, entry]);
  return { created: true, entry };
}

function removeEntry({ transport, chatId, applicationNumber }) {
  const entries = readEntries();
  const normalizedTransport = normalizeText(transport || 'whatsapp');
  const normalizedChatId = normalizeText(chatId);
  const normalizedApplicationNumber = normalizeText(applicationNumber);

  const next = entries.filter(
    (item) =>
      !(
        item.transport === normalizedTransport &&
        item.chatId === normalizedChatId &&
        item.applicationNumber === normalizedApplicationNumber
      )
  );

  const removed = next.length !== entries.length;
  if (removed) {
    writeEntries(next);
  }

  return { removed };
}

function updateEntry({ transport, chatId, applicationNumber, updates = {} }) {
  const entries = readEntries();
  const normalizedTransport = normalizeText(transport || 'whatsapp');
  const normalizedChatId = normalizeText(chatId);
  const normalizedApplicationNumber = normalizeText(applicationNumber);
  let updated = false;

  const next = entries.map((item) => {
    if (
      item.transport === normalizedTransport &&
      item.chatId === normalizedChatId &&
      item.applicationNumber === normalizedApplicationNumber
    ) {
      updated = true;
      return {
        ...item,
        ...updates,
        transport: item.transport,
        chatId: item.chatId,
        applicationNumber: item.applicationNumber,
        tag: typeof updates.tag === 'undefined' ? item.tag : normalizeText(updates.tag),
        lastSnapshot:
          typeof updates.lastSnapshot === 'undefined'
            ? item.lastSnapshot
            : normalizeText(updates.lastSnapshot),
        lastCheckedAt:
          typeof updates.lastCheckedAt === 'undefined'
            ? item.lastCheckedAt
            : updates.lastCheckedAt,
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
  addEntry,
  listEntries,
  readEntries,
  removeEntry,
  updateEntry,
  writeEntries,
};
