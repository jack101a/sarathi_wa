const { query, run } = require('./db');

const TRACKING_SCHEMA_LOCK_ID = 987654322;
let ensureSchemaPromise = null;

function metaOf(row) {
  if (!row) return {};
  if (!row.meta_json) return {};
  return typeof row.meta_json === 'string' ? JSON.parse(row.meta_json || '{}') : row.meta_json;
}

function toSarathi(row) {
  const meta = metaOf(row);
  const snapshot = typeof row.last_snapshot === 'string' ? row.last_snapshot : (row.last_snapshot && row.last_snapshot.text) || '';
  return {
    id: row.id,
    userId: row.user_id,
    appNo: row.app_number,
    chatId: row.chat_id,
    transport: row.transport,
    createdAt: row.created_at,
    lastStage: meta.lastStage || '',
    lastSnapshot: snapshot || meta.lastSnapshot || '',
    tag: meta.tag || '',
    dob: meta.dob || '',
    applicantName: meta.applicantName || '',
    serviceName: meta.serviceName || '',
    applicationDate: meta.applicationDate || '',
    scrutinyAt: meta.scrutinyAt || '',
    approvalAt: meta.approvalAt || '',
    dispatchedAt: meta.dispatchedAt || '',
  };
}

function toVahan(row) {
  const meta = metaOf(row);
  const snapshot = typeof row.last_snapshot === 'string' ? row.last_snapshot : (row.last_snapshot && row.last_snapshot.text) || '';
  return {
    id: row.id,
    userId: row.user_id,
    transport: row.transport,
    chatId: row.chat_id,
    applicationNumber: row.app_number,
    tag: meta.tag || '',
    createdAt: row.created_at,
    lastSnapshot: snapshot || meta.lastSnapshot || '',
    lastCheckedAt: row.last_checked_at || '',
    applicantName: meta.applicantName || '',
    serviceName: meta.serviceName || '',
    applicationDate: meta.applicationDate || '',
    vehicleNo: meta.vehicleNo || '',
    scrutinyAt: meta.scrutinyAt || '',
    approvalAt: meta.approvalAt || '',
    dispatchedAt: meta.dispatchedAt || '',
  };
}

async function createSchema() {
  await query('SELECT pg_advisory_lock(?)', [TRACKING_SCHEMA_LOCK_ID]);
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS tracked_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
        app_number VARCHAR(255) NOT NULL,
        app_type VARCHAR(50) NOT NULL,
        chat_id VARCHAR(255) NOT NULL,
        transport VARCHAR(50) NOT NULL,
        last_snapshot JSONB DEFAULT '{}'::jsonb,
        last_signature VARCHAR(255),
        last_checked_at TIMESTAMPTZ,
        meta_json JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(app_type, transport, chat_id, app_number)
      )
    `);
    await run('CREATE INDEX IF NOT EXISTS idx_tracked_applications_chat ON tracked_applications(app_type, transport, chat_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_tracked_applications_app ON tracked_applications(app_type, app_number)');
  } finally {
    await query('SELECT pg_advisory_unlock(?)', [TRACKING_SCHEMA_LOCK_ID]).catch(() => {});
  }
}

async function ensureSchema() {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = createSchema().catch((err) => {
      ensureSchemaPromise = null;
      throw err;
    });
  }

  return ensureSchemaPromise;
}

async function listByType(appType) {
  await ensureSchema();
  const rows = await query('SELECT * FROM tracked_applications WHERE app_type = ? ORDER BY created_at ASC', [appType]);
  return appType === 'vahan' ? rows.map(toVahan) : rows.map(toSarathi);
}

async function replaceType(appType, entries) {
  await ensureSchema();
  await run('DELETE FROM tracked_applications WHERE app_type = ?', [appType]);
  for (const entry of entries || []) await upsert(appType, entry);
}

async function upsert(appType, entry) {
  await ensureSchema();
  const appNumber = entry.appNo || entry.applicationNumber || entry.app_number;
  const chatId = entry.chatId || entry.chat_id;
  const transport = String(entry.transport || 'whatsapp').toLowerCase();
  if (!appNumber || !chatId) throw new Error('Tracked application requires app number and chat id');
  const meta = { ...entry };
  delete meta.id;
  delete meta.userId;
  delete meta.appNo;
  delete meta.applicationNumber;
  delete meta.app_number;
  delete meta.chatId;
  delete meta.chat_id;
  delete meta.transport;
  const lastSnapshot = entry.lastSnapshot || entry.last_snapshot || '';
  const rows = await query(
    `INSERT INTO tracked_applications (user_id, app_number, app_type, chat_id, transport, last_snapshot, last_checked_at, meta_json)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb)
     ON CONFLICT (app_type, transport, chat_id, app_number)
     DO UPDATE SET last_snapshot = EXCLUDED.last_snapshot, last_checked_at = EXCLUDED.last_checked_at, meta_json = EXCLUDED.meta_json, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [entry.userId || null, String(appNumber), appType, String(chatId), transport, JSON.stringify(lastSnapshot ? { text: lastSnapshot } : {}), entry.lastCheckedAt || null, JSON.stringify(meta)]
  );
  return appType === 'vahan' ? toVahan(rows[0]) : toSarathi(rows[0]);
}

async function remove(appType, { transport = 'whatsapp', chatId, appNo, applicationNumber }) {
  await ensureSchema();
  const appNumber = appNo || applicationNumber;
  const result = await run(
    'DELETE FROM tracked_applications WHERE app_type = ? AND transport = ? AND chat_id = ? AND app_number = ?',
    [appType, String(transport).toLowerCase(), chatId, appNumber]
  );
  return { removed: result.changes > 0 };
}

module.exports = { ensureSchema, listByType, replaceType, upsert, remove };
