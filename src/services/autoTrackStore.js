const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/config');
const db = require('../core/db');

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
let sqliteReady = false;
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
  try {
    ensureStoreDir();
    const p = getLegacyStorePath();
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
    fs.renameSync(tmp, p);
  } catch (_) {}
}

async function initSqlite() {
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS tracked_sarathi (
      app_no TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      transport TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_stage TEXT DEFAULT '',
      last_snapshot TEXT DEFAULT '',
      tag TEXT DEFAULT '',
      dob TEXT DEFAULT '',
      applicant_name TEXT DEFAULT '',
      service_name TEXT DEFAULT '',
      application_date TEXT DEFAULT '',
      scrutiny_at TEXT DEFAULT '',
      approval_at TEXT DEFAULT '',
      dispatched_at TEXT DEFAULT '',
      PRIMARY KEY (app_no, chat_id, transport)
    )`);
    const columns = await db.query('PRAGMA table_info(tracked_sarathi)');
    if (!columns.some((column) => column.name === 'application_date')) {
      await db.run("ALTER TABLE tracked_sarathi ADD COLUMN application_date TEXT DEFAULT ''");
    }
    await db.run('CREATE INDEX IF NOT EXISTS idx_tracked_sarathi_chat ON tracked_sarathi(chat_id, transport)');

    // one-time import from legacy/cache
    for (const e of cache) {
      await db.run(
        `INSERT OR IGNORE INTO tracked_sarathi (
          app_no, chat_id, transport, created_at, last_stage, last_snapshot, tag, dob,
          applicant_name, service_name, application_date, scrutiny_at, approval_at, dispatched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.appNo, e.chatId, e.transport, e.createdAt, e.lastStage, e.lastSnapshot, e.tag, e.dob, e.applicantName, e.serviceName, e.applicationDate, e.scrutinyAt, e.approvalAt, e.dispatchedAt]
      );
    }

    const rows = await db.query('SELECT * FROM tracked_sarathi');
    cache = normalizeEntries(
      rows.map((r) => ({
        appNo: r.app_no,
        chatId: r.chat_id,
        transport: r.transport,
        createdAt: r.created_at,
        lastStage: r.last_stage,
        lastSnapshot: r.last_snapshot,
        tag: r.tag,
        dob: r.dob,
        applicantName: r.applicant_name,
        serviceName: r.service_name,
        applicationDate: r.application_date,
        scrutinyAt: r.scrutiny_at,
        approvalAt: r.approval_at,
        dispatchedAt: r.dispatched_at,
      }))
    );
    sqliteReady = true;
    persistLegacy(cache);
  } catch (e) {
    sqliteReady = false;
  }
}

function queueSqlWrite(task) {
  if (!sqliteReady) return;
  writeQueue = writeQueue.then(task).catch(() => {});
}

function readTrackedApplications() {
  return [...cache];
}

function writeTrackedApplications(entries) {
  const safe = normalizeEntries(entries);
  cache = safe;
  persistLegacy(cache);
  queueSqlWrite(async () => {
    await db.run('DELETE FROM tracked_sarathi');
    for (const e of safe) {
      await db.run(
        `INSERT INTO tracked_sarathi (
          app_no, chat_id, transport, created_at, last_stage, last_snapshot, tag, dob,
          applicant_name, service_name, application_date, scrutiny_at, approval_at, dispatched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.appNo, e.chatId, e.transport, e.createdAt, e.lastStage, e.lastSnapshot, e.tag, e.dob, e.applicantName, e.serviceName, e.applicationDate, e.scrutinyAt, e.approvalAt, e.dispatchedAt]
      );
    }
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
initSqlite().catch(() => {});

module.exports = {
  readTrackedApplications,
  writeTrackedApplications,
  upsertTrackedApplication,
  removeTrackedApplication,
  updateTrackedApplication,
};
