const crypto = require('crypto');
const { query, run, runTransaction } = require('./db');

let initialized = false;
let initPromise = null;

function nowIso() { return new Date().toISOString(); }
function makeId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function planOf(user) { return user && (user.plan_id || user.subscription_plan) || 'free'; }

async function addColumnIfMissing(table, column, definition) {
  const rows = await query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = \'public\' AND table_name = ? AND column_name = ? LIMIT 1',
    [table, column]
  );
  if (rows.length === 0) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDb() {
  if (initialized) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // ── Serialize cross-container schema init with a PG advisory lock ────────
    // Multiple containers starting simultaneously on a fresh DB all race to run
    // CREATE TABLE. PG creates a pg_type entry before the table exists — if two
    // processes race, the second fails with "duplicate key on pg_type_typname_nsp_index".
    // Advisory lock (bigint key 987654321) ensures only ONE container runs initDb.
    let lockAcquired = false;
    for (let i = 0; i < 10; i++) {
      try {
        const [r] = await query('SELECT pg_try_advisory_lock(987654321) AS ok');
        if (r && r.ok) { lockAcquired = true; break; }
      } catch (_) { /* pg not ready yet */ }
      await new Promise(res => setTimeout(res, 500));
    }

    try {
    await run('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await run(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        limits_json JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS services (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        category VARCHAR(50) NOT NULL DEFAULT 'light',
        queue_type VARCHAR(50) NOT NULL DEFAULT 'api',
        credit_cost INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS plan_services (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id VARCHAR(255) REFERENCES subscription_plans(id) ON DELETE CASCADE,
        service_id VARCHAR(255) REFERENCES services(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plan_id, service_id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel VARCHAR(50) DEFAULT 'wa',
        canonical_phone VARCHAR(255) UNIQUE NOT NULL,
        is_active INTEGER DEFAULT 1,
        name VARCHAR(255) DEFAULT '',
        plan_id VARCHAR(255) REFERENCES subscription_plans(id) ON DELETE SET NULL,
        credits INTEGER DEFAULT 0,
        reserved_credits INTEGER DEFAULT 0,
        used_count INTEGER DEFAULT 0,
        daily_count INTEGER DEFAULT 0,
        expiry_date TIMESTAMPTZ,
        billing_cycle_start TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_daily_reset TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        rate_limit_overrides JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await addColumnIfMissing('auth_users', 'plan_id', "VARCHAR(255) REFERENCES subscription_plans(id) ON DELETE SET NULL");
    await addColumnIfMissing('auth_users', 'rate_limit_overrides', "JSONB DEFAULT '{}'::jsonb");
    await addColumnIfMissing('auth_users', 'reserved_credits', 'INTEGER DEFAULT 0');

    await run(`
      CREATE TABLE IF NOT EXISTS auth_user_identities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        identity_type VARCHAR(50) NOT NULL,
        identity_value VARCHAR(255) UNIQUE NOT NULL,
        verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS auth_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel VARCHAR(50) DEFAULT 'wa',
        canonical_phone VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        requested_by VARCHAR(255),
        requested_via VARCHAR(50) DEFAULT 'wa',
        expires_at TIMESTAMPTZ,
        verified_at TIMESTAMPTZ,
        verified_identity VARCHAR(255),
        meta_json JSONB DEFAULT '{}'::jsonb
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS authorized_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel VARCHAR(50) NOT NULL,
        group_id VARCHAR(255) NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_by VARCHAR(255) DEFAULT 'admin',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel, group_id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        amount INTEGER NOT NULL,
        balance_before INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        note TEXT DEFAULT '',
        triggered_by VARCHAR(50) DEFAULT 'system',
        job_id VARCHAR(255),
        payment_reference VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(255) PRIMARY KEY,
        user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
        user_phone VARCHAR(255),
        queue_type VARCHAR(50) NOT NULL,
        command VARCHAR(255) NOT NULL,
        payload JSONB DEFAULT '{}'::jsonb,
        status VARCHAR(50) DEFAULT 'pending',
        result JSONB DEFAULT '{}'::jsonb,
        error_text TEXT,
        chat_id VARCHAR(255) NOT NULL,
        transport VARCHAR(50) DEFAULT 'wa',
        priority INTEGER DEFAULT 0,
        worker_id VARCHAR(255),
        dedup_key VARCHAR(255) UNIQUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS rate_limit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
        timestamp TIMESTAMPTZ NOT NULL,
        command VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'light'
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS payment_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
        utr VARCHAR(255) UNIQUE NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        admin_note TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        verified_at TIMESTAMPTZ
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS service_price_overrides (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_type VARCHAR(50) NOT NULL,
        scope_id VARCHAR(255) NOT NULL,
        service_id VARCHAR(255) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        credit_cost INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        note TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(scope_type, scope_id, service_id)
      )
    `);

    await run('CREATE INDEX IF NOT EXISTS idx_identities_user_fk ON auth_user_identities(auth_user_id)');
    await run('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)');
    await run('CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status)');
    await run('CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue_type, status)');
    await run('CREATE INDEX IF NOT EXISTS idx_rate_log_user ON rate_limit_log(user_id, timestamp)');
    await run('CREATE INDEX IF NOT EXISTS idx_rate_log_cat ON rate_limit_log(user_id, category, timestamp)');
    await run('CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at)');
    await run('CREATE INDEX IF NOT EXISTS idx_payment_req_status ON payment_requests(status)');
    await run('CREATE INDEX IF NOT EXISTS idx_service_price_overrides_lookup ON service_price_overrides(scope_type, scope_id, service_id, is_active)');

    const freeLimits = JSON.stringify({ light: { perDay: 20, perMonth: 300 }, medium: { perDay: 5, perMonth: 60 }, maxConcurrent: 2 });
    const premiumLimits = JSON.stringify({ light: { perDay: 100, perMonth: 3000 }, medium: { perDay: 20, perMonth: 600 }, maxConcurrent: 5 });
    const existingPlans = await query("SELECT id FROM subscription_plans WHERE id IN ('free', 'premium')");
    const existingIds = existingPlans.map(p => p.id);

    if (!existingIds.includes('free')) {
      await run(
        'INSERT INTO subscription_plans (id, name, description, limits_json, is_active) VALUES (?, ?, ?, ?::jsonb, 1)',
        ['free', 'Free Tier', 'Basic access to light services', freeLimits]
      );
    }
    if (!existingIds.includes('premium')) {
      await run(
        'INSERT INTO subscription_plans (id, name, description, limits_json, is_active) VALUES (?, ?, ?, ?::jsonb, 1)',
        ['premium', 'Premium Tier', 'Full access to all services', premiumLimits]
      );
    }

    const services = [
      ['track', 'DL Status Track', 'light', 'api', 0, 10],
      ['track_multiple', 'Multi-App Tracking', 'light', 'api', 0, 15],
      ['track_rc', 'RC Status Track', 'light', 'api', 0, 20],
      ['track_status', 'Tracking List', 'light', 'api', 0, 30],
      ['add_track', 'Add DL Auto-Track', 'light', 'api', 0, 40],
      ['add_track_rc', 'Add RC Auto-Track', 'light', 'api', 0, 45],
      ['remove_track', 'Remove DL Auto-Track', 'light', 'api', 0, 50],
      ['remove_track_rc', 'Remove RC Auto-Track', 'light', 'api', 0, 55],
      ['list_track', 'List All Tracking', 'light', 'api', 0, 60],
      ['refresh_track', 'Refresh All Tracking', 'light', 'api', 0, 70],
      ['form1', 'Self-Declaration Form', 'light', 'api', 0, 80],
      ['form1a', 'Medical Certificate', 'light', 'api', 0, 90],
      ['form2', 'Form 2 Application', 'light', 'api', 0, 100],
      ['formset', 'Combined Form Set', 'light', 'api', 0, 110],
      ['appl_pdf', 'Acknowledgement Receipt', 'light', 'api', 0, 120],
      ['appl_image', 'Acknowledgement Image', 'light', 'api', 0, 125],
      ['slot_pdf', 'Slot Booking Receipt', 'light', 'api', 0, 130],
      ['alive', 'Bot Health Check', 'light', 'api', 0, 140],
      ['resend_otp', 'LL Password Resend', 'medium', 'api', 0, 200],
      ['llprint_start', 'LL Print / Download', 'medium', 'browser', 0, 210],
      ['fee_print_start', 'Fee Receipt Print', 'medium', 'browser', 0, 220],
      ['pay_fee_start', 'Fee Payment', 'medium', 'browser', 0, 230],
      ['slot_booking_start', 'DL Test Slot Booking', 'medium', 'browser', 0, 240],
      ['dl_info_start', 'DL Info Lookup', 'medium', 'browser', 0, 250],
      ['lledit_start', 'LL Edit', 'heavy', 'browser', 50, 260],
      ['dl_renewal_start', 'DL Renewal / Duplicate', 'heavy', 'browser', 50, 270],
      ['apply_dl_start', 'Apply for New DL', 'heavy', 'browser', 50, 280],
      ['mobupdate_start', 'Mobile Number Update', 'heavy', 'browser', 50, 290],
      ['auto_track_check', 'Scheduled DL Tracking', 'light', 'api', 0, 900],
      ['vahan_track_check', 'Scheduled RC Tracking', 'light', 'api', 0, 910],
      ['daily_reports_check', 'Daily Reports', 'light', 'api', 0, 920]
    ];
    for (const [id, name, category, queueType, cost, sort] of services) {
      await run(
        `INSERT INTO services (id, name, category, queue_type, credit_cost, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           queue_type = EXCLUDED.queue_type,
           credit_cost = EXCLUDED.credit_cost,
           sort_order = EXCLUDED.sort_order,
           updated_at = CURRENT_TIMESTAMP`,
        [id, name, category, queueType, cost, sort]
      );
    }

    if (!existingIds.includes('premium')) {
      await run("INSERT INTO plan_services (plan_id, service_id) SELECT 'premium', id FROM services ON CONFLICT DO NOTHING");
    }
    if (!existingIds.includes('free')) {
      await run("INSERT INTO plan_services (plan_id, service_id) SELECT 'free', id FROM services WHERE category = 'light' ON CONFLICT DO NOTHING");
    }

    const CONFIG = require('./config');
    const users = (CONFIG.SECURITY && CONFIG.SECURITY.AUTHORIZED_USERS) || [];
    for (const phone of users) {
      const digits = String(phone).trim().replace(/\D/g, '');
      if (!digits) continue;
      const user = await createUser(digits, 'wa');
      await createUserIdentity(user.id, 'wa_cus', `${digits}@c.us`);
    }

      initialized = true;
      return true;
    } finally {
      // Always release the advisory lock so other containers can proceed
      if (lockAcquired) {
        await query('SELECT pg_advisory_unlock(987654321)').catch(() => {});
      }
    }
  })().catch((err) => {
    console.error('[authRepo] Database initialization failed:', err.message);
    initPromise = null;
    throw err;
  });

  return initPromise;
}

function userSelect() {
  return `SELECT *, COALESCE(plan_id, 'free') AS subscription_plan FROM auth_users`;
}

async function getUserByPhone(phone, { includeInactive = false } = {}) {
  const activeClause = includeInactive ? '' : ' AND is_active = 1';
  const rows = await query(`${userSelect()} WHERE canonical_phone = ?${activeClause}`, [phone]);
  return rows[0] || null;
}

async function getUserById(id) {
  const rows = await query(`${userSelect()} WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function createUser(phone, channel = 'wa') {
  const existing = await getUserByPhone(phone);
  if (existing) return existing;
  const rows = await query(
    `INSERT INTO auth_users (channel, canonical_phone, is_active, plan_id)
     VALUES (?, ?, 1, 'free')
     ON CONFLICT (canonical_phone) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *, COALESCE(plan_id, 'free') AS subscription_plan`,
    [channel, phone]
  );
  return rows[0];
}

async function updateUserProfile(phone, updates = {}) {
  const fields = [];
  const params = [];
  if (typeof updates.name !== 'undefined') { fields.push('name = ?'); params.push(updates.name); }
  if (typeof updates.plan_id !== 'undefined' || typeof updates.subscription_plan !== 'undefined' || typeof updates.plan !== 'undefined') {
    fields.push('plan_id = ?');
    params.push(updates.plan_id || updates.subscription_plan || updates.plan || 'free');
  }
  if (typeof updates.expiry_date !== 'undefined') { fields.push('expiry_date = ?'); params.push(updates.expiry_date || null); }
  if (typeof updates.is_active !== 'undefined') { fields.push('is_active = ?'); params.push(updates.is_active ? 1 : 0); }
  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(phone);
  await run(`UPDATE auth_users SET ${fields.join(', ')} WHERE canonical_phone = ?`, params);
  return getUserByPhone(phone);
}

async function listAllUsers() {
  return query(`
    SELECT u.*, COALESCE(u.plan_id, 'free') AS subscription_plan,
           STRING_AGG(DISTINCT i.identity_value, ',') AS identities,
           v.code AS pending_otp
    FROM auth_users u
    LEFT JOIN auth_user_identities i ON u.id = i.auth_user_id AND i.is_active = 1
    LEFT JOIN auth_verifications v ON u.canonical_phone = v.canonical_phone AND v.status = 'pending' AND v.expires_at > CURRENT_TIMESTAMP
    WHERE u.is_active = 1
    GROUP BY u.id, v.code
    ORDER BY u.created_at DESC
  `);
}

async function createUserIdentity(userId, type, value) {
  const rows = await query(
    `INSERT INTO auth_user_identities (auth_user_id, identity_type, identity_value, is_active)
     VALUES (?, ?, ?, 1)
     ON CONFLICT (identity_value) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, is_active = 1
     RETURNING *`,
    [userId, type, value]
  );
  return rows[0];
}

async function getIdentity(value) {
  const rows = await query('SELECT * FROM auth_user_identities WHERE identity_value = ? AND is_active = 1', [value]);
  return rows[0] || null;
}

async function createVerification(phone, code, requestedBy, requestedVia = 'wa') {
  const rows = await query(
    `INSERT INTO auth_verifications (canonical_phone, code, status, requested_by, requested_via, expires_at)
     VALUES (?, ?, 'pending', ?, ?, ?)
     RETURNING *`,
    [phone, code, requestedBy, requestedVia, new Date(Date.now() + 15 * 60 * 1000).toISOString()]
  );
  return rows[0];
}

async function getPendingVerification(phone, code) {
  const rows = await query(
    "SELECT * FROM auth_verifications WHERE canonical_phone = ? AND code = ? AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP",
    [phone, code]
  );
  return rows[0] || null;
}

async function updateVerificationStatus(id, status, verifiedIdentity) {
  await run('UPDATE auth_verifications SET status = ?, verified_at = CURRENT_TIMESTAMP, verified_identity = ? WHERE id = ?', [status, verifiedIdentity, id]);
}

async function hasPendingVerification(phone) {
  const rows = await query(
    "SELECT 1 FROM auth_verifications WHERE canonical_phone = ? AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP LIMIT 1",
    [phone]
  );
  return rows.length > 0;
}

async function getAuthorizedGroups(channel) {
  return query('SELECT * FROM authorized_groups WHERE channel = ? AND is_active = 1', [channel]);
}

async function addAuthorizedGroup(groupId, channel, createdBy = 'admin') {
  const rows = await query(
    `INSERT INTO authorized_groups (channel, group_id, is_active, created_by)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (channel, group_id) DO UPDATE SET is_active = 1
     RETURNING *`,
    [channel, groupId, createdBy]
  );
  return rows[0];
}

async function removeAuthorizedGroup(groupId, channel) {
  await run('UPDATE authorized_groups SET is_active = 0 WHERE group_id = ? AND channel = ?', [groupId, channel]);
}

async function incrementUsage(userId) {
  await run('UPDATE auth_users SET used_count = COALESCE(used_count,0)+1, daily_count = COALESCE(daily_count,0)+1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
}
async function resetMonthlyUsage(userId) { await run('UPDATE auth_users SET used_count = 0, billing_cycle_start = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]); }
async function resetDailyCount(userId) { await run('UPDATE auth_users SET daily_count = 0, last_daily_reset = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]); }
async function deactivateUserById(id) { await run('UPDATE auth_users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]); return true; }
async function deactivateUser(phone) {
  const user = await getUserByPhone(phone, { includeInactive: true });
  if (!user) return false;
  await run('UPDATE auth_users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE canonical_phone = ?', [phone]);
  await run('UPDATE auth_user_identities SET is_active = 0 WHERE auth_user_id = ?', [user.id]);
  return true;
}

async function getCredits(userId) {
  const rows = await query('SELECT credits FROM auth_users WHERE id = ?', [userId]);
  return Number((rows[0] && rows[0].credits) || 0);
}
async function addCredits(userId, amount) { return (await addCreditsAudited(userId, amount, '', 'admin')).newBalance; }
async function setCredits(userId, amount) { return (await setCreditsAudited(userId, amount, '', 'admin')).newBalance; }

async function addCreditsAudited(userId, amount, note = '', triggeredBy = 'admin', jobId = '') {
  const n = Math.max(0, Number(amount) || 0);
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const [user] = await txQ('SELECT credits FROM auth_users WHERE id = ? FOR UPDATE', [userId]);
    const before = Number(user?.credits || 0);
    const after = before + n;
    await txR('UPDATE auth_users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [after, userId]);
    await txR(
      'INSERT INTO credit_transactions (user_id, action, amount, balance_before, balance_after, note, triggered_by, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [userId, 'add', n, before, after, note, triggeredBy, jobId]
    );
    return { newBalance: after };
  });
}

async function setCreditsAudited(userId, amount, note = '', triggeredBy = 'admin') {
  const n = Math.max(0, Number(amount) || 0);
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const [user] = await txQ('SELECT credits FROM auth_users WHERE id = ? FOR UPDATE', [userId]);
    const before = Number(user?.credits || 0);
    await txR('UPDATE auth_users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [n, userId]);
    await txR(
      'INSERT INTO credit_transactions (user_id, action, amount, balance_before, balance_after, note, triggered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [userId, 'set', n, before, n, note, triggeredBy]
    );
    return { newBalance: n };
  });
}

async function deductCreditsAudited(userId, amount, note = '', jobId = '') {
  const n = Math.max(0, Number(amount) || 0);
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const [user] = await txQ('SELECT credits FROM auth_users WHERE id = ? FOR UPDATE', [userId]);
    const before = Number(user?.credits || 0);
    const after = Math.max(0, before - n);
    await txR('UPDATE auth_users SET credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [after, userId]);
    await txR(
      'INSERT INTO credit_transactions (user_id, action, amount, balance_before, balance_after, note, triggered_by, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [userId, 'deduct', n, before, after, note, 'job_completion', jobId]
    );
    return { newBalance: after };
  });
}

async function reserveCreditsForJob(userId, amount, command = '', jobId = '') {
  const n = Math.max(0, Number(amount) || 0);
  if (n === 0) return { reserved: 0 };
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const [user] = await txQ('SELECT credits, COALESCE(reserved_credits,0) AS reserved_credits FROM auth_users WHERE id = ? FOR UPDATE', [userId]);
    if (!user) throw new Error('User not found for credit reservation');
    const credits = Number(user.credits || 0);
    const reserved = Number(user.reserved_credits || 0);
    const available = credits - reserved;
    if (available < n) {
      const err = new Error(`Insufficient available credits. Required ${n}, available ${available}.`);
      err.code = 'INSUFFICIENT_CREDITS';
      err.available = available;
      err.required = n;
      throw err;
    }
    await txR('UPDATE auth_users SET reserved_credits = COALESCE(reserved_credits,0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [n, userId]);
    return { reserved: n, availableBefore: available, command, jobId };
  });
}

async function finalizeReservedCreditsForJob(userId, amount, note = '', jobId = '') {
  const n = Math.max(0, Number(amount) || 0);
  if (n === 0) return { newBalance: await getCredits(userId) };
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const [user] = await txQ('SELECT credits, COALESCE(reserved_credits,0) AS reserved_credits FROM auth_users WHERE id = ? FOR UPDATE', [userId]);
    if (!user) throw new Error('User not found for credit finalization');
    const before = Number(user.credits || 0);
    const reserved = Number(user.reserved_credits || 0);
    const finalAmount = Math.min(n, reserved);
    const after = Math.max(0, before - finalAmount);
    await txR('UPDATE auth_users SET credits = ?, reserved_credits = GREATEST(COALESCE(reserved_credits,0) - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [after, finalAmount, userId]);
    await txR(
      'INSERT INTO credit_transactions (user_id, action, amount, balance_before, balance_after, note, triggered_by, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [userId, 'deduct', finalAmount, before, after, note, 'job_completion', jobId]
    );
    return { newBalance: after };
  });
}

async function releaseReservedCreditsForJob(userId, amount, jobId = '') {
  const n = Math.max(0, Number(amount) || 0);
  if (n === 0) return { released: 0 };
  return runTransaction(async ({ query: txQ, run: txR }) => {
    const [user] = await txQ('SELECT COALESCE(reserved_credits,0) AS reserved_credits FROM auth_users WHERE id = ? FOR UPDATE', [userId]);
    if (!user) return { released: 0 };
    const released = Math.min(n, Number(user.reserved_credits || 0));
    await txR('UPDATE auth_users SET reserved_credits = GREATEST(COALESCE(reserved_credits,0) - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [released, userId]);
    return { released, jobId };
  });
}

async function getCreditHistory(userId, limit = 50) {
  return query('SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
}

async function getUserRateOverrides(userId) {
  const rows = await query('SELECT rate_limit_overrides FROM auth_users WHERE id = ?', [userId]);
  return rows[0]?.rate_limit_overrides || {};
}
async function setUserRateOverrides(userId, overrides) {
  await run('UPDATE auth_users SET rate_limit_overrides = ?::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(overrides || {}), userId]);
  return overrides;
}

async function getActivityLog(filters = {}) {
  let sql = 'SELECT * FROM rate_limit_log WHERE 1=1';
  const params = [];
  if (filters.userId) {
    sql += ' AND (user_id::text = ? OR user_id IN (SELECT id FROM auth_users WHERE canonical_phone = ?))';
    params.push(filters.userId, filters.userId);
  }
  if (filters.category) { sql += ' AND category = ?'; params.push(filters.category); }
  if (filters.from) { sql += ' AND timestamp >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND timestamp <= ?'; params.push(filters.to); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(Number(filters.limit) || 200);
  return query(sql, params);
}

async function getJobStats() {
  const [total] = await query('SELECT COUNT(*) AS c FROM jobs');
  const [pending] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'pending'");
  const [running] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'running'");
  const [completed] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'completed'");
  const [failed] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed'");
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const [today] = await query('SELECT COUNT(*) AS c FROM jobs WHERE created_at >= ?', [todayStart.toISOString()]);
  const [todayDone] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'completed' AND created_at >= ?", [todayStart.toISOString()]);
  const todayCount = Number(today?.c || 0);
  const doneCount = Number(todayDone?.c || 0);
  return {
    total: Number(total?.c || 0), pending: Number(pending?.c || 0), running: Number(running?.c || 0),
    completed: Number(completed?.c || 0), failed: Number(failed?.c || 0),
    todayCount, successRate: todayCount > 0 ? Math.round((doneCount / todayCount) * 100) : 100,
  };
}

async function getTotalCredits() {
  const [row] = await query('SELECT COALESCE(SUM(credits),0) AS total FROM auth_users WHERE is_active = 1');
  return Number(row?.total || 0);
}
async function getTotalCreditsSpent() {
  const [row] = await query("SELECT COALESCE(SUM(amount),0) AS total FROM credit_transactions WHERE action = 'deduct'");
  return Number(row?.total || 0);
}
async function getUsersWithSpentCredits({ includeInactive = false } = {}) {
  const activeClause = includeInactive ? '' : 'WHERE u.is_active = 1';
  return query(`
    SELECT u.*, COALESCE(u.plan_id, 'free') AS subscription_plan,
           COALESCE((SELECT SUM(ct.amount) FROM credit_transactions ct WHERE ct.user_id = u.id AND ct.action = 'deduct'), 0) AS credits_spent,
           STRING_AGG(DISTINCT i.identity_value, ',') AS identities,
           v.code AS pending_otp
    FROM auth_users u
    LEFT JOIN auth_user_identities i ON u.id = i.auth_user_id AND i.is_active = 1
    LEFT JOIN auth_verifications v ON u.canonical_phone = v.canonical_phone AND v.status = 'pending' AND v.expires_at > CURRENT_TIMESTAMP
    ${activeClause}
    GROUP BY u.id, v.code
    ORDER BY u.created_at DESC
  `);
}

function manualWalletTopupDisabled() {
  const err = new Error('Manual UPI/UTR wallet top-up is disabled. Use Razorpay QR top-up.');
  err.code = 'MANUAL_WALLET_TOPUP_DISABLED';
  throw err;
}

async function createPaymentRequest(userId, utr, amount = 0) {
  manualWalletTopupDisabled();
}
async function getPendingPaymentRequests() {
  return query("SELECT p.*, u.canonical_phone, u.name AS user_name FROM payment_requests p LEFT JOIN auth_users u ON p.user_id = u.id WHERE p.status = 'pending' ORDER BY p.created_at DESC");
}
async function getAllPaymentRequests() {
  return query("SELECT p.*, u.canonical_phone, u.name AS user_name FROM payment_requests p LEFT JOIN auth_users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT 100");
}
async function approvePaymentRequest(id, amount, note = '', adminName = 'admin') {
  manualWalletTopupDisabled();
}
async function rejectPaymentRequest(id, note = '') {
  manualWalletTopupDisabled();
}

initDb().catch((err) => {
  console.error('[authRepo] DB init failed — will retry on next request:', err.message);
});

module.exports = {
  initDb,
  query,
  run,
  getUserByPhone,
  getUserById,
  listAllUsers,
  createUser,
  updateUserProfile,
  incrementUsage,
  resetMonthlyUsage,
  resetDailyCount,
  deactivateUserById,
  deactivateUser,
  createUserIdentity,
  getIdentity,
  createVerification,
  getPendingVerification,
  updateVerificationStatus,
  hasPendingVerification,
  getAuthorizedGroups,
  addAuthorizedGroup,
  removeAuthorizedGroup,
  addCredits,
  setCredits,
  getCredits,
  addCreditsAudited,
  setCreditsAudited,
  deductCreditsAudited,
  reserveCreditsForJob,
  finalizeReservedCreditsForJob,
  releaseReservedCreditsForJob,
  getCreditHistory,
  getUserRateOverrides,
  setUserRateOverrides,
  getActivityLog,
  getJobStats,
  getTotalCredits,
  getTotalCreditsSpent,
  getUsersWithSpentCredits,
  createPaymentRequest,
  getPendingPaymentRequests,
  getAllPaymentRequests,
  approvePaymentRequest,
  rejectPaymentRequest,
  makeId,
  planOf
};
