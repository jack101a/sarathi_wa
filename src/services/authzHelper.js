const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const dbPath = process.env.AUTHZ_DB_PATH || path.resolve(__dirname, '../../data/authz.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new sqlite3.Database(dbPath);

function execRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function initDb() {
  await execRun(`CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, channel TEXT, canonical_phone TEXT UNIQUE, is_active INTEGER, created_at TEXT, updated_at TEXT)`);
  await execRun(`CREATE TABLE IF NOT EXISTS auth_user_identities (id TEXT PRIMARY KEY, auth_user_id TEXT, identity_type TEXT, identity_value TEXT UNIQUE, verified_at TEXT, last_seen_at TEXT, is_active INTEGER)`);
  await execRun(`CREATE TABLE IF NOT EXISTS auth_verifications (id TEXT PRIMARY KEY, channel TEXT, canonical_phone TEXT, code TEXT, status TEXT, requested_by TEXT, requested_via TEXT, expires_at TEXT, verified_at TEXT, verified_identity TEXT, meta_json TEXT)`);
  await execRun(`CREATE TABLE IF NOT EXISTS authorized_groups (id TEXT PRIMARY KEY, channel TEXT, group_id TEXT, is_active INTEGER, created_by TEXT, created_at TEXT)`);

  // Subscription plans
  await execRun(`CREATE TABLE IF NOT EXISTS subscription_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', services_json TEXT DEFAULT '["*"]', limits_json TEXT DEFAULT '{}', is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL)`);
  
  // Seed default plans if empty
  const planCount = await getAsync('SELECT COUNT(*) as count FROM subscription_plans');
  if (planCount && planCount.count === 0) {
    const now = new Date().toISOString();
    const freeLimits = JSON.stringify({ light: { perDay: 20, perMonth: 300 }, medium: { perDay: 5, perMonth: 60 } });
    const premLimits = JSON.stringify({ light: { perDay: 100, perMonth: 3000 }, medium: { perDay: 20, perMonth: 600 } });
    const freeServices = JSON.stringify(['track', 'status', 'llprint', 'feeprint', 'pay_fee_start']);
    
    await execRun('INSERT INTO subscription_plans (id, name, description, services_json, limits_json, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', 
      ['free', 'Free Tier', 'Basic access to status and tracking', freeServices, freeLimits, now]);
    await execRun('INSERT INTO subscription_plans (id, name, description, services_json, limits_json, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', 
      ['premium', 'Premium Tier', 'Full access to all services', '["*"]', premLimits, now]);
  }

  const migrations = [
    "ALTER TABLE auth_users ADD COLUMN name TEXT DEFAULT ''",
    "ALTER TABLE auth_users ADD COLUMN subscription_plan TEXT DEFAULT 'standard'",
    "ALTER TABLE auth_users ADD COLUMN monthly_limit INTEGER DEFAULT 0",
    "ALTER TABLE auth_users ADD COLUMN used_count INTEGER DEFAULT 0",
    "ALTER TABLE auth_users ADD COLUMN daily_count INTEGER DEFAULT 0",
    "ALTER TABLE auth_users ADD COLUMN expiry_date TEXT DEFAULT ''",
    "ALTER TABLE auth_users ADD COLUMN billing_cycle_start TEXT DEFAULT ''",
    "ALTER TABLE auth_users ADD COLUMN last_daily_reset TEXT DEFAULT ''",
    // Credit balance for professional/heavy services (50 RS per job deducted on success)
    "ALTER TABLE auth_users ADD COLUMN credits INTEGER DEFAULT 0",
    // Per-user rate limit overrides (JSON, e.g. {"light":{"perDay":50},"medium":{"perDay":10}})
    "ALTER TABLE auth_users ADD COLUMN rate_limit_overrides TEXT DEFAULT '{}'"
  ];
  for (const sql of migrations) {
    try { await execRun(sql); } catch (_) {}
  }

  // Credit transaction audit trail
  await execRun(`CREATE TABLE IF NOT EXISTS credit_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, action TEXT NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER DEFAULT 0, balance_after INTEGER DEFAULT 0, note TEXT DEFAULT '', triggered_by TEXT DEFAULT 'admin', job_id TEXT DEFAULT '', created_at TEXT NOT NULL)`);
  await execRun('CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at)');

  await execRun(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_phone TEXT NOT NULL, queue_type TEXT NOT NULL, command TEXT NOT NULL, payload_json TEXT DEFAULT '{}', status TEXT DEFAULT 'pending', result_json TEXT DEFAULT '{}', error_text TEXT DEFAULT '', chat_id TEXT NOT NULL, transport TEXT DEFAULT 'whatsapp', priority INTEGER DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT DEFAULT '', completed_at TEXT DEFAULT '')`);
  await execRun('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)');
  await execRun('CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, status)');
  await execRun('CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(queue_type, status)');

  // rate_limit_log: category column for per-category quota counting (light/medium/heavy)
  await execRun(`CREATE TABLE IF NOT EXISTS rate_limit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, timestamp TEXT NOT NULL, command TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'light')`);
  // Migration: add category column to existing DBs BEFORE creating index on it
  try { await execRun("ALTER TABLE rate_limit_log ADD COLUMN category TEXT NOT NULL DEFAULT 'light'"); } catch (_) {}
  await execRun('CREATE INDEX IF NOT EXISTS idx_rate_log_user ON rate_limit_log(user_id, timestamp)');
  await execRun('CREATE INDEX IF NOT EXISTS idx_rate_log_cat  ON rate_limit_log(user_id, category, timestamp)');
}

const command = process.argv[2];
if (command === 'init') {
  initDb().then(() => db.close()).catch((err) => { console.error(err); db.close(); process.exit(1); });
} else if (command === 'query') {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    const payload = JSON.parse(input || '{}');
    db.all(payload.sql, payload.params || [], (err, rows) => {
      if (err) { console.error(err); db.close(); process.exit(1); }
      else { console.log(JSON.stringify(rows || [])); db.close(); }
    });
  });
} else if (command === 'run') {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    const payload = JSON.parse(input || '{}');
    db.run(payload.sql, payload.params || [], (err) => {
      if (err) { console.error(err); db.close(); process.exit(1); }
      else { console.log(JSON.stringify({ success: true })); db.close(); }
    });
  });
}
