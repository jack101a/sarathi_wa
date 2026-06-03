const { Pool } = require('pg');
require('dotenv').config();

const dbPath = process.env.DATABASE_URL || 'postgres://sarathi@localhost:5432/sarathi';

function getPgConfig() {
  if (process.env.PGHOST || process.env.PGPASSWORD) {
    return {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || 'sarathi',
      user: process.env.PGUSER || 'sarathi',
      password: process.env.PGPASSWORD || undefined,
    };
  }

  return { connectionString: dbPath };
}

let pool;

function getDb() {
  if (pool) return pool;
  
  pool = new Pool({
    ...getPgConfig(),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err.message);
  });

  return pool;
}

function convertSql(sql) {
  if (typeof sql !== 'string') return sql;
  let converted = sql;

  // 1. Replace ? placeholders with $1, $2, etc.
  let paramIndex = 0;
  converted = converted.replace(/\?/g, () => `$${++paramIndex}`);

  // 2. PRAGMA table_info(tracked_sarathi) -> information_schema
  if (/pragma\s+table_info\((tracked_sarathi|tracked_vahan)\)/i.test(converted)) {
    const tableName = converted.match(/pragma\s+table_info\((tracked_sarathi|tracked_vahan)\)/i)[1];
    return `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${tableName}'`;
  }

  // 3. General PRAGMA statements -> SELECT 1 (no-op)
  if (/^\s*pragma\s+/i.test(converted)) {
    return 'SELECT 1';
  }

  // 4. GROUP_CONCAT(DISTINCT i.identity_value) -> STRING_AGG(DISTINCT i.identity_value, ',')
  converted = converted.replace(/group_concat\((distinct\s+)?([^)]+)\)/gi, (match, dist, expr) => {
    const distinctStr = dist ? 'DISTINCT ' : '';
    return `STRING_AGG(${distinctStr}${expr.trim()}, ',')`;
  });

  // 5. INSERT OR IGNORE -> ON CONFLICT DO NOTHING
  if (/^\s*insert\s+or\s+ignore\s+into\s+(\w+)/i.test(converted)) {
    const tableName = converted.match(/^\s*insert\s+or\s+ignore\s+into\s+(\w+)/i)[1];
    converted = converted.replace(/insert\s+or\s+ignore\s+into/gi, 'INSERT INTO');
    if (!/on\s+conflict/i.test(converted)) {
      if (tableName.toLowerCase() === 'tracked_sarathi') {
        converted += ' ON CONFLICT (app_no, chat_id, transport) DO NOTHING';
      } else if (tableName.toLowerCase() === 'tracked_vahan') {
        converted += ' ON CONFLICT (transport, chat_id, application_number) DO NOTHING';
      } else {
        converted += ' ON CONFLICT DO NOTHING';
      }
    }
  }

  // 6. INSERT OR REPLACE or REPLACE
  if (/^\s*(insert\s+or\s+replace\s+into|replace\s+into)\s+(\w+)/i.test(converted)) {
    const tableName = converted.match(/^\s*(insert\s+or\s+replace\s+into|replace\s+into)\s+(\w+)/i)[2];
    converted = converted.replace(/insert\s+or\s+replace\s+into/gi, 'INSERT INTO');
    converted = converted.replace(/replace\s+into/gi, 'INSERT INTO');
    if (tableName.toLowerCase() === 'authorized_groups') {
      converted += ' ON CONFLICT (id) DO UPDATE SET channel = EXCLUDED.channel, group_id = EXCLUDED.group_id, is_active = EXCLUDED.is_active, created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at';
    } else if (tableName.toLowerCase() === 'tracked_sarathi') {
      converted += ' ON CONFLICT (app_no, chat_id, transport) DO UPDATE SET last_stage = EXCLUDED.last_stage, last_snapshot = EXCLUDED.last_snapshot, tag = EXCLUDED.tag, dob = EXCLUDED.dob, applicant_name = EXCLUDED.applicant_name, service_name = EXCLUDED.service_name, application_date = EXCLUDED.application_date, scrutiny_at = EXCLUDED.scrutiny_at, approval_at = EXCLUDED.approval_at, dispatched_at = EXCLUDED.dispatched_at';
    } else if (tableName.toLowerCase() === 'tracked_vahan') {
      converted += ' ON CONFLICT (transport, chat_id, application_number) DO UPDATE SET tag = EXCLUDED.tag, last_snapshot = EXCLUDED.last_snapshot, last_checked_at = EXCLUDED.last_checked_at, applicant_name = EXCLUDED.applicant_name, service_name = EXCLUDED.service_name, application_date = EXCLUDED.application_date, vehicle_no = EXCLUDED.vehicle_no, scrutiny_at = EXCLUDED.scrutiny_at, approval_at = EXCLUDED.approval_at, dispatched_at = EXCLUDED.dispatched_at';
    } else {
      converted += ' ON CONFLICT (id) DO UPDATE SET updated_at = NOW()';
    }
  }

  // 7. datetime('now', '-30 days') -> NOW() + '-30 days'::interval / datetime('now', $1) -> NOW() + ($1)::interval
  converted = converted.replace(/datetime\('now',\s*'([^']+)'\)/gi, "NOW() + '$1'::interval");
  converted = converted.replace(/datetime\('now',\s*(\$\d+|\?)\)/gi, "NOW() + ($1)::interval");
  converted = converted.replace(/datetime\('now'\)/gi, 'NOW()');
  converted = converted.replace(/datetime\('now',\s*'localtime'\)/gi, 'NOW()');

  // 8. sqlite_version() -> version()
  converted = converted.replace(/sqlite_version\(\)/gi, 'version()');

  // SQLite examples commonly use lowercase `excluded`; PostgreSQL wants `EXCLUDED`.
  converted = converted.replace(/\bexcluded\./gi, 'EXCLUDED.');

  return converted;
}

async function query(sql, params = []) {
  const p = getDb();
  const convertedSql = convertSql(sql);
  const res = await p.query(convertedSql, params);
  return res.rows || [];
}

async function run(sql, params = []) {
  const p = getDb();
  const convertedSql = convertSql(sql);
  
  // If INSERT and doesn't have RETURNING, append RETURNING to populate lastID
  let querySql = convertedSql;
  if (/^\s*insert\s+/i.test(querySql) && !/returning/i.test(querySql)) {
    // If table name is credit_transactions (which has autoincrement primary key id) or jobs or rate_limit_log,
    // they have different id types, returning id works for all.
    querySql += ' RETURNING id';
  }
  
  const res = await p.query(querySql, params);
  const lastID = res.rows && res.rows[0] ? res.rows[0].id : null;
  return { lastID, changes: res.rowCount };
}

async function runTransaction(fn) {
  const p = getDb();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    
    const txQuery = async (sql, params = []) => {
      const converted = convertSql(sql);
      const res = await client.query(converted, params);
      return res.rows || [];
    };
    
    const txRun = async (sql, params = []) => {
      let converted = convertSql(sql);
      if (/^\s*insert\s+/i.test(converted) && !/returning/i.test(converted)) {
        converted += ' RETURNING id';
      }
      const res = await client.query(converted, params);
      const lastID = res.rows && res.rows[0] ? res.rows[0].id : null;
      return { lastID, changes: res.rowCount };
    };

    const result = await fn({ query: txQuery, run: txRun });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function checkpoint() {
  // No-op for PostgreSQL
  return Promise.resolve();
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function reopen() {
  await close();
  getDb();
}

module.exports = { query, run, close, reopen, getDb, runTransaction, checkpoint, dbPath };
