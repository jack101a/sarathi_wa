const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/config');
const { trackingRepository } = require('@sarathi/common');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getLegacyStorePath() {
  return CONFIG.VAHAN_TRACK.STORE_PATH;
}

function ensureStoreDir() {
  const dir = path.dirname(getLegacyStorePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeEntries(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => item && item.chatId && item.applicationNumber)
    .map((item) => ({
      transport: normalizeText(item.transport || 'whatsapp').toLowerCase(),
      chatId: normalizeText(item.chatId),
      applicationNumber: normalizeText(item.applicationNumber),
      tag: normalizeText(item.tag),
      createdAt: item.createdAt || new Date().toISOString(),
      lastSnapshot: normalizeText(item.lastSnapshot),
      lastCheckedAt: item.lastCheckedAt || '',
      applicantName: normalizeText(item.applicantName),
      serviceName: normalizeText(item.serviceName),
      applicationDate: normalizeText(item.applicationDate),
      vehicleNo: normalizeText(item.vehicleNo),
      scrutinyAt: normalizeText(item.scrutinyAt),
      approvalAt: normalizeText(item.approvalAt),
      dispatchedAt: normalizeText(item.dispatchedAt),
    }));
}

let cache = [];
let storeReady = false;
let writeQueue = Promise.resolve();

function readLegacy() {
  try {
    const p = getLegacyStorePath();
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return [];
    return normalizeEntries(JSON.parse(raw));
  } catch (_) {
    return [];
  }
}

function persistLegacy(entries) {
  void entries;
}

async function initStore() {
  try {
    await trackingRepository.ensureSchema();
    if (cache.length > 0) {
      for (const e of cache) await trackingRepository.upsert('vahan', e);
    }
    cache = normalizeEntries(await trackingRepository.listByType('vahan'));
    storeReady = true;
  } catch (e) {
    console.error('[vahanTrackStore] Postgres init failed:', e.message);
    storeReady = false;
  }
}

function queuePostgresWrite(task) {
  if (!storeReady) return;
  writeQueue = writeQueue.then(task).catch((err) => {
    console.error('[vahanTrackStore] Postgres write failed:', err.message);
  });
}

function readEntries() {
  return [...cache];
}

function writeEntries(entries) {
  const safe = normalizeEntries(entries);
  cache = safe;
  persistLegacy(cache);
  queuePostgresWrite(async () => {
    await trackingRepository.replaceType('vahan', safe);
  });
  return safe;
}

function listEntries(transport, chatId) {
  return readEntries().filter((item) => item.transport === normalizeText(transport || 'whatsapp').toLowerCase() && item.chatId === normalizeText(chatId));
}

function addEntry({ transport, chatId, applicationNumber, tag, vehicleNo, applicantName }) {
  const entries = readEntries();
  const normalizedTransport = normalizeText(transport || 'whatsapp').toLowerCase();
  const normalizedChatId = normalizeText(chatId);
  const normalizedApplicationNumber = normalizeText(applicationNumber);
  const normalizedTag = normalizeText(tag);
  const normalizedVehicleNo = normalizeText(vehicleNo);
  const normalizedApplicantName = normalizeText(applicantName);

  const exists = entries.find((item) => item.transport === normalizedTransport && item.chatId === normalizedChatId && item.applicationNumber === normalizedApplicationNumber);
  if (exists) return { created: false, entry: exists };

  const entry = {
    transport: normalizedTransport,
    chatId: normalizedChatId,
    applicationNumber: normalizedApplicationNumber,
    tag: normalizedTag,
    createdAt: new Date().toISOString(),
    lastSnapshot: '',
    lastCheckedAt: '',
    applicantName: normalizedApplicantName || normalizedTag,
    serviceName: '',
    applicationDate: '',
    vehicleNo: normalizedVehicleNo,
    scrutinyAt: '',
    approvalAt: '',
    dispatchedAt: '',
  };

  writeEntries([...entries, entry]);
  return { created: true, entry };
}

function removeEntry({ transport, chatId, applicationNumber }) {
  const entries = readEntries();
  const normalizedTransport = normalizeText(transport || 'whatsapp').toLowerCase();
  const normalizedChatId = normalizeText(chatId);
  const normalizedApplicationNumber = normalizeText(applicationNumber);

  const next = entries.filter((item) => !(item.transport === normalizedTransport && item.chatId === normalizedChatId && item.applicationNumber === normalizedApplicationNumber));
  const removed = next.length !== entries.length;
  if (removed) writeEntries(next);
  return { removed };
}

function updateEntry({ transport, chatId, applicationNumber, updates = {} }) {
  const entries = readEntries();
  const normalizedTransport = normalizeText(transport || 'whatsapp').toLowerCase();
  const normalizedChatId = normalizeText(chatId);
  const normalizedApplicationNumber = normalizeText(applicationNumber);
  let updated = false;

  const next = entries.map((item) => {
    if (item.transport === normalizedTransport && item.chatId === normalizedChatId && item.applicationNumber === normalizedApplicationNumber) {
      updated = true;
      return {
        ...item,
        ...updates,
        transport: item.transport,
        chatId: item.chatId,
        applicationNumber: item.applicationNumber,
        tag: typeof updates.tag === 'undefined' ? item.tag : normalizeText(updates.tag),
        lastSnapshot: typeof updates.lastSnapshot === 'undefined' ? item.lastSnapshot : normalizeText(updates.lastSnapshot),
        lastCheckedAt: typeof updates.lastCheckedAt === 'undefined' ? item.lastCheckedAt : updates.lastCheckedAt,
        applicantName: typeof updates.applicantName === 'undefined' ? item.applicantName || '' : normalizeText(updates.applicantName),
        serviceName: typeof updates.serviceName === 'undefined' ? item.serviceName || '' : normalizeText(updates.serviceName),
        applicationDate: typeof updates.applicationDate === 'undefined' ? item.applicationDate || '' : normalizeText(updates.applicationDate),
        vehicleNo: typeof updates.vehicleNo === 'undefined' ? item.vehicleNo || '' : normalizeText(updates.vehicleNo),
        scrutinyAt: typeof updates.scrutinyAt === 'undefined' ? item.scrutinyAt || '' : normalizeText(updates.scrutinyAt),
        approvalAt: typeof updates.approvalAt === 'undefined' ? item.approvalAt || '' : normalizeText(updates.approvalAt),
        dispatchedAt: typeof updates.dispatchedAt === 'undefined' ? item.dispatchedAt || '' : normalizeText(updates.dispatchedAt),
      };
    }
    return item;
  });

  if (updated) writeEntries(next);
  return { updated };
}

cache = readLegacy();
initStore().catch(() => {});

module.exports = {
  addEntry,
  listEntries,
  readEntries,
  removeEntry,
  updateEntry,
  writeEntries,
};
