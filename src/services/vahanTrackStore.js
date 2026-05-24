const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/config');
const db = require('../core/db');
const { runTransaction } = require('../core/db');

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
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch (_) {}
}

async function initSqlite() {
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS tracked_vahan (
      transport TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      application_number TEXT NOT NULL,
      tag TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      last_snapshot TEXT DEFAULT '',
      last_checked_at TEXT DEFAULT '',
      applicant_name TEXT DEFAULT '',
      service_name TEXT DEFAULT '',
      application_date TEXT DEFAULT '',
      vehicle_no TEXT DEFAULT '',
      scrutiny_at TEXT DEFAULT '',
      approval_at TEXT DEFAULT '',
      dispatched_at TEXT DEFAULT '',
      PRIMARY KEY (transport, chat_id, application_number)
    )`);
    const columns = await db.query('PRAGMA table_info(tracked_vahan)');
    if (!columns.some((column) => column.name === 'application_date')) {
      await db.run("ALTER TABLE tracked_vahan ADD COLUMN application_date TEXT DEFAULT ''");
    }
    await db.run('CREATE INDEX IF NOT EXISTS idx_tracked_vahan_chat ON tracked_vahan(chat_id, transport)');

    for (const e of cache) {
      await db.run(
        `INSERT OR IGNORE INTO tracked_vahan (
          transport, chat_id, application_number, tag, created_at, last_snapshot, last_checked_at,
          applicant_name, service_name, application_date, vehicle_no, scrutiny_at, approval_at, dispatched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.transport, e.chatId, e.applicationNumber, e.tag, e.createdAt, e.lastSnapshot, e.lastCheckedAt, e.applicantName, e.serviceName, e.applicationDate, e.vehicleNo, e.scrutinyAt, e.approvalAt, e.dispatchedAt]
      );
    }

    const rows = await db.query('SELECT * FROM tracked_vahan');
    cache = normalizeEntries(rows.map((r) => ({
      transport: r.transport,
      chatId: r.chat_id,
      applicationNumber: r.application_number,
      tag: r.tag,
      createdAt: r.created_at,
      lastSnapshot: r.last_snapshot,
      lastCheckedAt: r.last_checked_at,
      applicantName: r.applicant_name,
      serviceName: r.service_name,
      applicationDate: r.application_date,
      vehicleNo: r.vehicle_no,
      scrutinyAt: r.scrutiny_at,
      approvalAt: r.approval_at,
      dispatchedAt: r.dispatched_at,
    })));

    sqliteReady = true;
    persistLegacy(cache);
  } catch (e) {
    console.error('[vahanTrackStore] SQLite init failed:', e.message);
    sqliteReady = false;
  }
}

function queueSqlWrite(task) {
  if (!sqliteReady) return;
  writeQueue = writeQueue.then(task).catch((err) => {
    console.error('[vahanTrackStore] SQLite write failed:', err.message);
  });
}

function readEntries() {
  return [...cache];
}

function writeEntries(entries) {
  const safe = normalizeEntries(entries);
  cache = safe;
  persistLegacy(cache);
  queueSqlWrite(async () => {
    await runTransaction(async ({ run: txR }) => {
      await txR('DELETE FROM tracked_vahan');
      for (const e of safe) {
        await txR(
          `INSERT INTO tracked_vahan (
            transport, chat_id, application_number, tag, created_at, last_snapshot, last_checked_at,
            applicant_name, service_name, application_date, vehicle_no, scrutiny_at, approval_at, dispatched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.transport, e.chatId, e.applicationNumber, e.tag, e.createdAt, e.lastSnapshot, e.lastCheckedAt, e.applicantName, e.serviceName, e.applicationDate, e.vehicleNo, e.scrutinyAt, e.approvalAt, e.dispatchedAt]
        );
      }
    });
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
initSqlite().catch(() => {});

module.exports = {
  addEntry,
  listEntries,
  readEntries,
  removeEntry,
  updateEntry,
  writeEntries,
};
