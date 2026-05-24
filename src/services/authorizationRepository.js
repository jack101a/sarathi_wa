const { query, run, runTransaction } = require('../core/db');

let initialized = false;

function nowIso() { return new Date().toISOString(); }
function makeId(prefix) { return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`; }

async function initDb() {
  if (initialized) return true;
  try {
    // Schema creation — directly in-process, no child process needed
    await run(`CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, channel TEXT, canonical_phone TEXT UNIQUE, is_active INTEGER, created_at TEXT, updated_at TEXT)`);
    await run(`CREATE TABLE IF NOT EXISTS auth_user_identities (id TEXT PRIMARY KEY, auth_user_id TEXT, identity_type TEXT, identity_value TEXT UNIQUE, verified_at TEXT, last_seen_at TEXT, is_active INTEGER)`);
    await run(`CREATE TABLE IF NOT EXISTS auth_verifications (id TEXT PRIMARY KEY, channel TEXT, canonical_phone TEXT, code TEXT, status TEXT, requested_by TEXT, requested_via TEXT, expires_at TEXT, verified_at TEXT, verified_identity TEXT, meta_json TEXT)`);
    await run(`CREATE TABLE IF NOT EXISTS authorized_groups (id TEXT PRIMARY KEY, channel TEXT, group_id TEXT, is_active INTEGER, created_by TEXT, created_at TEXT)`);
    await run(`CREATE TABLE IF NOT EXISTS subscription_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', services_json TEXT DEFAULT '["*"]', limits_json TEXT DEFAULT '{}', is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL)`);

    // Seed default plans if empty
    const planRows = await query('SELECT COUNT(*) as count FROM subscription_plans');
    if (planRows[0] && planRows[0].count === 0) {
      const now = nowIso();
      const freeLimits = JSON.stringify({ light: { perDay: 20, perMonth: 300 }, medium: { perDay: 5, perMonth: 60 } });
      const premLimits = JSON.stringify({ light: { perDay: 100, perMonth: 3000 }, medium: { perDay: 20, perMonth: 600 } });
      const freeServices = JSON.stringify(['track', 'status', 'llprint', 'feeprint', 'pay_fee_start']);
      await run('INSERT INTO subscription_plans (id, name, description, services_json, limits_json, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', ['free', 'Free Tier', 'Basic access to status and tracking', freeServices, freeLimits, now]);
      await run('INSERT INTO subscription_plans (id, name, description, services_json, limits_json, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', ['premium', 'Premium Tier', 'Full access to all services', '["*"]', premLimits, now]);
    }

    // Column migrations — log failures instead of silently swallowing
    const migrations = [
      "ALTER TABLE auth_users ADD COLUMN name TEXT DEFAULT ''",
      "ALTER TABLE auth_users ADD COLUMN subscription_plan TEXT DEFAULT 'standard'",
      "ALTER TABLE auth_users ADD COLUMN monthly_limit INTEGER DEFAULT 0",
      "ALTER TABLE auth_users ADD COLUMN used_count INTEGER DEFAULT 0",
      "ALTER TABLE auth_users ADD COLUMN daily_count INTEGER DEFAULT 0",
      "ALTER TABLE auth_users ADD COLUMN expiry_date TEXT DEFAULT ''",
      "ALTER TABLE auth_users ADD COLUMN billing_cycle_start TEXT DEFAULT ''",
      "ALTER TABLE auth_users ADD COLUMN last_daily_reset TEXT DEFAULT ''",
      "ALTER TABLE auth_users ADD COLUMN credits INTEGER DEFAULT 0",
      "ALTER TABLE auth_users ADD COLUMN rate_limit_overrides TEXT DEFAULT '{}'",
    ];
    for (const sql of migrations) {
      try { await run(sql); } catch (e) {
        // "duplicate column name" is expected on subsequent runs — only that is OK to ignore
        if (!String(e.message || '').includes('duplicate column')) {
          console.error(`[authRepo] Migration warning: ${e.message}`);
        }
      }
    }

    await run(`CREATE TABLE IF NOT EXISTS credit_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, action TEXT NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER DEFAULT 0, balance_after INTEGER DEFAULT 0, note TEXT DEFAULT '', triggered_by TEXT DEFAULT 'admin', job_id TEXT DEFAULT '', created_at TEXT NOT NULL)`);
    await run('CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at)');
    await run(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_phone TEXT NOT NULL, queue_type TEXT NOT NULL, command TEXT NOT NULL, payload_json TEXT DEFAULT '{}', status TEXT DEFAULT 'pending', result_json TEXT DEFAULT '{}', error_text TEXT DEFAULT '', chat_id TEXT NOT NULL, transport TEXT DEFAULT 'whatsapp', priority INTEGER DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT DEFAULT '', completed_at TEXT DEFAULT '')`);
    await run('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)');
    await run('CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, status)');
    await run('CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(queue_type, status)');
    await run(`CREATE TABLE IF NOT EXISTS rate_limit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, timestamp TEXT NOT NULL, command TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'light')`);
    try { await run("ALTER TABLE rate_limit_log ADD COLUMN category TEXT NOT NULL DEFAULT 'light'"); } catch (_) {}
    await run('CREATE INDEX IF NOT EXISTS idx_rate_log_user ON rate_limit_log(user_id, timestamp)');
    await run('CREATE INDEX IF NOT EXISTS idx_rate_log_cat ON rate_limit_log(user_id, category, timestamp)');

    // Foreign-key indexes
    await run('CREATE INDEX IF NOT EXISTS idx_credit_tx_user_fk ON credit_transactions(user_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_identities_user_fk ON auth_user_identities(auth_user_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_jobs_user_fk ON jobs(user_id)');

    // Seed config users
    const CONFIG = require('../config/config');
    const users = (CONFIG.SECURITY && CONFIG.SECURITY.AUTHORIZED_USERS) || [];
    for (const phone of users) {
      const digits = String(phone).trim().replace(/\D/g, '');
      if (!digits) continue;
      const existing = await getUserByPhone(digits);
      if (!existing) {
        const user = await createUser(digits, 'wa');
        await createUserIdentity(user.id, 'wa_cus', `${digits}@c.us`);
      }
    }

    initialized = true;
    return true;
  } catch (err) {
    console.error('[authRepo] Database initialization failed:', err.message);
    return false;
  }
}

async function getUserByPhone(phone) {
  const rows = await query('SELECT * FROM auth_users WHERE canonical_phone = ? AND is_active = 1', [phone]);
  return rows[0] || null;
}
async function getUserById(id) {
  const rows = await query('SELECT * FROM auth_users WHERE id = ?', [id]);
  return rows[0] || null;
}
async function listAllUsers() {
  return query(`
    SELECT u.*, 
           GROUP_CONCAT(DISTINCT i.identity_value) AS identities, 
           v.code AS pending_otp 
    FROM auth_users u 
    LEFT JOIN auth_user_identities i ON u.id = i.auth_user_id AND i.is_active = 1 
    LEFT JOIN auth_verifications v ON u.canonical_phone = v.canonical_phone AND v.status = 'pending' 
    WHERE u.is_active = 1 
    GROUP BY u.id 
    ORDER BY u.created_at DESC
  `);
}

async function createUser(phone, channel = 'wa') {
  const existing = await getUserByPhone(phone);
  if (existing) return existing;
  const id = makeId('user');
  const now = nowIso();
  await run('INSERT INTO auth_users (id, channel, canonical_phone, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(canonical_phone) DO UPDATE SET updated_at = excluded.updated_at', [id, channel, phone, now, now]);
  return { id, channel, canonical_phone: phone, is_active: 1, created_at: now, updated_at: now };
}

async function updateUserProfile(phone, updates = {}) {
  const fields = [];
  const params = [];
  if (typeof updates.name !== 'undefined') { fields.push('name = ?'); params.push(updates.name); }
  if (typeof updates.subscription_plan !== 'undefined') { fields.push('subscription_plan = ?'); params.push(updates.subscription_plan); }
  if (typeof updates.monthly_limit !== 'undefined') { fields.push('monthly_limit = ?'); params.push(Number(updates.monthly_limit) || 0); }
  if (typeof updates.expiry_date !== 'undefined') { fields.push('expiry_date = ?'); params.push(updates.expiry_date); }
  if (typeof updates.is_active !== 'undefined') { fields.push('is_active = ?'); params.push(updates.is_active ? 1 : 0); }
  fields.push('updated_at = ?'); params.push(nowIso());
  params.push(phone);
  await run(`UPDATE auth_users SET ${fields.join(', ')} WHERE canonical_phone = ?`, params);
  return getUserByPhone(phone);
}

async function incrementUsage(userId) { await run('UPDATE auth_users SET used_count = COALESCE(used_count,0)+1, daily_count = COALESCE(daily_count,0)+1, updated_at = ? WHERE id = ?', [nowIso(), userId]); }
async function resetMonthlyUsage(userId) { await run('UPDATE auth_users SET used_count = 0, billing_cycle_start = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), userId]); }
async function resetDailyCount(userId) { await run('UPDATE auth_users SET daily_count = 0, last_daily_reset = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), userId]); }
async function deactivateUserById(id) { await run('UPDATE auth_users SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]); return true; }

async function deactivateUser(phone) {
  const user = await getUserByPhone(phone);
  if (!user) return false;
  await run('UPDATE auth_users SET is_active = 0, updated_at = ? WHERE canonical_phone = ?', [nowIso(), phone]);
  await run('UPDATE auth_user_identities SET is_active = 0 WHERE auth_user_id = ?', [user.id]);
  return true;
}

async function createUserIdentity(userId, type, value) {
  const id = makeId('ident');
  const now = nowIso();
  await run('INSERT INTO auth_user_identities (id, auth_user_id, identity_type, identity_value, verified_at, last_seen_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(identity_value) DO UPDATE SET last_seen_at = excluded.last_seen_at, is_active = 1', [id, userId, type, value, now, now]);
  return { id, auth_user_id: userId, identity_type: type, identity_value: value, verified_at: now, last_seen_at: now, is_active: 1 };
}
async function getIdentity(value) { const rows = await query('SELECT * FROM auth_user_identities WHERE identity_value = ? AND is_active = 1', [value]); return rows[0] || null; }

async function createVerification(phone, code, requestedBy, requestedVia = 'wa') {
  const id = makeId('verif');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await run('INSERT INTO auth_verifications (id, channel, canonical_phone, code, status, requested_by, requested_via, expires_at, verified_at, verified_identity, meta_json) VALUES (?, "wa", ?, ?, "pending", ?, ?, ?, NULL, NULL, "{}")', [id, phone, code, requestedBy, requestedVia, expiresAt]);
  return { id, channel: 'wa', canonical_phone: phone, code, status: 'pending', requested_by: requestedBy, requested_via: requestedVia, expires_at: expiresAt };
}
async function getPendingVerification(phone, code) { const rows = await query('SELECT * FROM auth_verifications WHERE canonical_phone = ? AND code = ? AND status = "pending" AND expires_at > ?', [phone, code, nowIso()]); return rows[0] || null; }
async function updateVerificationStatus(id, status, verifiedIdentity) { await run('UPDATE auth_verifications SET status = ?, verified_at = ?, verified_identity = ? WHERE id = ?', [status, nowIso(), verifiedIdentity, id]); }
async function hasPendingVerification(phone) {
  const nowStr = nowIso();
  const rows = await query('SELECT 1 FROM auth_verifications WHERE canonical_phone = ? AND status = "pending" AND expires_at > ? LIMIT 1', [phone, nowStr]);
  return rows && rows.length > 0;
}


async function getAuthorizedGroups(channel) { return query('SELECT * FROM authorized_groups WHERE channel = ? AND is_active = 1', [channel]); }
async function addAuthorizedGroup(groupId, channel, createdBy = 'admin') {
  const id = makeId('group');
  await run('INSERT OR REPLACE INTO authorized_groups (id, channel, group_id, is_active, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?)', [id, channel, groupId, createdBy, nowIso()]);
  return { id, channel, group_id: groupId, is_active: 1, created_by: createdBy };
}
async function removeAuthorizedGroup(groupId, channel) { await run('UPDATE authorized_groups SET is_active = 0 WHERE group_id = ? AND channel = ?', [groupId, channel]); }

async function addCredits(userId, amount) {
  const n = Math.max(0, Number(amount) || 0);
  await run('UPDATE auth_users SET credits = COALESCE(credits,0) + ?, updated_at = ? WHERE id = ?', [n, nowIso(), userId]);
  const rows = await query('SELECT credits FROM auth_users WHERE id = ?', [userId]);
  return Number((rows[0] && rows[0].credits) || 0);
}
async function setCredits(userId, amount) {
  const n = Math.max(0, Number(amount) || 0);
  await run('UPDATE auth_users SET credits = ?, updated_at = ? WHERE id = ?', [n, nowIso(), userId]);
  return n;
}
async function getCredits(userId) {
  const rows = await query('SELECT credits FROM auth_users WHERE id = ?', [userId]);
  return Number((rows[0] && rows[0].credits) || 0);
}

async function queryAsync(sql, params = []) { return query(sql, params); }
async function runAsync(sql, params = []) { return run(sql, params); }

// ── Audited Credit Operations ─────────────────────────────────────────────
async function addCreditsAudited(userId, amount, note = '', triggeredBy = 'admin', jobId = '') {
  const n = Math.max(0, Number(amount) || 0);
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const rows = await txQ('SELECT credits FROM auth_users WHERE id = ?', [userId]);
    const before = Number((rows[0] && rows[0].credits) || 0);
    const after = before + n;
    await txR('UPDATE auth_users SET credits = ?, updated_at = ? WHERE id = ?', [after, nowIso(), userId]);
    await txR('INSERT INTO credit_transactions (user_id, action, amount, balance_before, balance_after, note, triggered_by, job_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [userId, 'add', n, before, after, note, triggeredBy, jobId, nowIso()]);
    return { newBalance: after };
  });
}

async function setCreditsAudited(userId, amount, note = '', triggeredBy = 'admin') {
  const n = Math.max(0, Number(amount) || 0);
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const rows = await txQ('SELECT credits FROM auth_users WHERE id = ?', [userId]);
    const before = Number((rows[0] && rows[0].credits) || 0);
    await txR('UPDATE auth_users SET credits = ?, updated_at = ? WHERE id = ?', [n, nowIso(), userId]);
    await txR('INSERT INTO credit_transactions (user_id, action, amount, balance_before, balance_after, note, triggered_by, job_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [userId, 'set', n, before, n, note, triggeredBy, '', nowIso()]);
    return { newBalance: n };
  });
}

async function deductCreditsAudited(userId, amount, note = '', jobId = '') {
  const n = Math.max(0, Number(amount) || 0);
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const rows = await txQ('SELECT credits FROM auth_users WHERE id = ?', [userId]);
    const before = Number((rows[0] && rows[0].credits) || 0);
    const after = Math.max(0, before - n);
    await txR('UPDATE auth_users SET credits = ?, updated_at = ? WHERE id = ?', [after, nowIso(), userId]);
    await txR('INSERT INTO credit_transactions (user_id, action, amount, balance_before, balance_after, note, triggered_by, job_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [userId, 'deduct', n, before, after, note, 'job_completion', jobId, nowIso()]);
    return { newBalance: after };
  });
}

async function getCreditHistory(userId, limit = 50) {
  return query('SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
}

// ── Per-User Rate Limit Overrides ─────────────────────────────────────────
async function getUserRateOverrides(userId) {
  const rows = await query('SELECT rate_limit_overrides FROM auth_users WHERE id = ?', [userId]);
  try { return JSON.parse((rows[0] && rows[0].rate_limit_overrides) || '{}'); } catch (_) { return {}; }
}

async function setUserRateOverrides(userId, overrides) {
  const json = JSON.stringify(overrides || {});
  await run('UPDATE auth_users SET rate_limit_overrides = ?, updated_at = ? WHERE id = ?', [json, nowIso(), userId]);
  return overrides;
}

// ── Activity Log Queries ──────────────────────────────────────────────────
async function getActivityLog(filters = {}) {
  let sql = 'SELECT * FROM rate_limit_log WHERE 1=1';
  const params = [];
  if (filters.userId)   { sql += ' AND user_id = ?';   params.push(filters.userId); }
  if (filters.category) { sql += ' AND category = ?';  params.push(filters.category); }
  if (filters.from)     { sql += ' AND timestamp >= ?'; params.push(filters.from); }
  if (filters.to)       { sql += ' AND timestamp <= ?'; params.push(filters.to); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(Number(filters.limit) || 200);
  return query(sql, params);
}

// ── Job Stats ─────────────────────────────────────────────────────────────
async function getJobStats() {
  const [total]     = await query('SELECT COUNT(*) AS c FROM jobs');
  const [pending]   = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'pending'");
  const [running]   = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'running'");
  const [completed] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'completed'");
  const [failed]    = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed'");
  const todayStart  = new Date(); todayStart.setHours(0,0,0,0);
  const [today]     = await query('SELECT COUNT(*) AS c FROM jobs WHERE created_at >= ?', [todayStart.toISOString()]);
  const [todayDone] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'completed' AND created_at >= ?", [todayStart.toISOString()]);
  const todayCount  = Number(today?.c || 0);
  const doneCount   = Number(todayDone?.c || 0);
  return {
    total: Number(total?.c || 0), pending: Number(pending?.c || 0), running: Number(running?.c || 0),
    completed: Number(completed?.c || 0), failed: Number(failed?.c || 0),
    todayCount, successRate: todayCount > 0 ? Math.round((doneCount / todayCount) * 100) : 100,
  };
}

// ── Total Credits in System ───────────────────────────────────────────────
async function getTotalCredits() {
  const [row] = await query('SELECT COALESCE(SUM(credits),0) AS total FROM auth_users WHERE is_active = 1');
  return Number(row?.total || 0);
}

initDb();
module.exports = { initDb, query: queryAsync, run: runAsync, getUserByPhone, getUserById, listAllUsers, createUser, updateUserProfile, incrementUsage, resetMonthlyUsage, resetDailyCount, deactivateUserById, deactivateUser, createUserIdentity, getIdentity, createVerification, getPendingVerification, updateVerificationStatus, hasPendingVerification, getAuthorizedGroups, addAuthorizedGroup, removeAuthorizedGroup, addCredits, setCredits, getCredits, addCreditsAudited, setCreditsAudited, deductCreditsAudited, getCreditHistory, getUserRateOverrides, setUserRateOverrides, getActivityLog, getJobStats, getTotalCredits };

