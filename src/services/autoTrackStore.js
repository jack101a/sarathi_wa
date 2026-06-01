const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/config');
const { trackingRepository } = require('@sarathi/common');

function getLegacyStorePath() {
  return CONFIG.AUTO_TRACK.STORE_PATH;
}

function ensureStoreDir() {
  const dir = path.dirname(getLegacyStorePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function normalizeEntries(data) {
  if (!Array.isArray(data)) return [];
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
      applicantName: String(item.applicantName || '').trim(),
      serviceName: String(item.serviceName || '').trim(),
      applicationDate: String(item.applicationDate || '').trim(),
      scrutinyAt: String(item.scrutinyAt || '').trim(),
      approvalAt: String(item.approvalAt || '').trim(),
      dispatchedAt: String(item.dispatchedAt || '').trim(),
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
      for (const e of cache) await trackingRepository.upsert('sarathi', e);
    }
    cache = normalizeEntries(await trackingRepository.listByType('sarathi'));
    storeReady = true;
  } catch (e) {
    console.error('[autoTrackStore] Postgres init failed:', e.message);
    storeReady = false;
  }
}

function queueSqlWrite(task) {
  if (!storeReady) return;
  writeQueue = writeQueue.then(task).catch((err) => {
    console.error('[autoTrackStore] Postgres write failed:', err.message);
  });
}

function readTrackedApplications() {
  return [...cache];
}

function writeTrackedApplications(entries) {
  const safe = normalizeEntries(entries);
  cache = safe;
  persistLegacy(cache);
  queueSqlWrite(async () => {
    await trackingRepository.replaceType('sarathi', safe);
  });
  return safe;
}

function upsertTrackedApplication(entry) {
  const appNo = String(entry.appNo || '').trim();
  const chatId = String(entry.chatId || '').trim();
  const transport = String(entry.transport || '').trim().toLowerCase();
  const tag = String(entry.tag || '').trim();
  const dob = String(entry.dob || '').trim();
  if (!appNo || !chatId || !transport) throw new Error('Application number, chat ID, and transport are required.');

  const existing = readTrackedApplications();
  const duplicate = existing.find((i) => i.appNo === appNo && i.chatId === chatId && i.transport === transport);
  if (duplicate) return { created: false, entries: existing };

  const next = [...existing, {
    appNo, chatId, transport, tag, dob,
    createdAt: new Date().toISOString(),
    lastStage: '', lastSnapshot: '',
    applicantName: '', serviceName: '', applicationDate: '', scrutinyAt: '', approvalAt: '', dispatchedAt: '',
  }];

  return { created: true, entries: writeTrackedApplications(next) };
}

function removeTrackedApplication(entry) {
  const appNo = String(entry.appNo || '').trim();
  const chatId = String(entry.chatId || '').trim();
  const transport = String(entry.transport || '').trim().toLowerCase();
  const existing = readTrackedApplications();
  const next = existing.filter((i) => !(i.appNo === appNo && i.chatId === chatId && i.transport === transport));
  const removed = next.length !== existing.length;
  if (removed) writeTrackedApplications(next);
  return { removed, entries: removed ? next : existing };
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
        tag: typeof updates.tag === 'undefined' ? item.tag || '' : String(updates.tag || '').trim(),
        dob: typeof updates.dob === 'undefined' ? item.dob || '' : String(updates.dob || '').trim(),
        applicantName: typeof updates.applicantName === 'undefined' ? item.applicantName || '' : String(updates.applicantName || '').trim(),
        serviceName: typeof updates.serviceName === 'undefined' ? item.serviceName || '' : String(updates.serviceName || '').trim(),
        applicationDate: typeof updates.applicationDate === 'undefined' ? item.applicationDate || '' : String(updates.applicationDate || '').trim(),
        scrutinyAt: typeof updates.scrutinyAt === 'undefined' ? item.scrutinyAt || '' : String(updates.scrutinyAt || '').trim(),
        approvalAt: typeof updates.approvalAt === 'undefined' ? item.approvalAt || '' : String(updates.approvalAt || '').trim(),
        dispatchedAt: typeof updates.dispatchedAt === 'undefined' ? item.dispatchedAt || '' : String(updates.dispatchedAt || '').trim(),
        lastSnapshot: typeof updates.lastSnapshot === 'undefined' ? item.lastSnapshot || '' : String(updates.lastSnapshot || '').trim(),
        lastStage: typeof updates.lastStage === 'undefined' ? item.lastStage || '' : String(updates.lastStage || '').trim(),
      };
    }
    return item;
  });

  if (!updated) return { updated: false, entries: existing };
  return { updated: true, entries: writeTrackedApplications(next) };
}

cache = readLegacy();
initStore().catch(() => {});

module.exports = {
  readTrackedApplications,
  writeTrackedApplications,
  upsertTrackedApplication,
  removeTrackedApplication,
  updateTrackedApplication,
};
