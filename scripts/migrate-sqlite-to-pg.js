const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
require('dotenv').config();

const sqliteDbPath = process.env.AUTHZ_DB_PATH || 'data/authz.sqlite';
const pgConnectionString = process.env.DATABASE_URL;

if (!pgConnectionString) {
  console.error('Error: DATABASE_URL is not set in environment or .env file');
  process.exit(1);
}

const pgPool = new Pool({
  connectionString: pgConnectionString,
});

const sqliteDb = new sqlite3.Database(sqliteDbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error(`Error opening SQLite database at ${sqliteDbPath}:`, err.message);
    process.exit(1);
  }
});

// Helper to run SQLite query returning a promise
function querySqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Convert ISO string or date to Date object, or fallback
function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

async function migrate() {
  console.log('Starting SQLite to PostgreSQL migration...');
  console.log(`SQLite Path: ${sqliteDbPath}`);
  console.log(`PG Database: ${pgConnectionString.replace(/:([^:@]+)@/, ':****@')}`); // Hide password

  const pgClient = await pgPool.connect();

  try {
    // 1. Begin PG transaction
    await pgClient.query('BEGIN');

    // 2. Fetch all SQLite plans
    console.log('Migrating subscription plans...');
    const sqlitePlans = await querySqlite('SELECT * FROM subscription_plans');
    for (const plan of sqlitePlans) {
      let limits = {};
      try {
        limits = plan.limits_json ? JSON.parse(plan.limits_json) : {};
      } catch (e) {
        limits = {};
      }

      await pgClient.query(
        `INSERT INTO subscription_plans (id, name, description, is_active, limits_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           is_active = EXCLUDED.is_active,
           limits_json = EXCLUDED.limits_json
        `,
        [
          plan.id,
          plan.name,
          plan.description || '',
          plan.is_active === 1 || plan.is_active === true,
          JSON.stringify(limits),
          parseDate(plan.created_at) || new Date()
        ]
      );
    }
    console.log(`Migrated ${sqlitePlans.length} plans.`);

    // 3. Fetch and migrate services
    console.log('Migrating services...');
    const sqliteServices = await querySqlite('SELECT * FROM services');
    for (const s of sqliteServices) {
      await pgClient.query(
        `INSERT INTO services (id, name, category, queue_type, credit_cost, is_active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           queue_type = EXCLUDED.queue_type,
           credit_cost = EXCLUDED.credit_cost,
           is_active = EXCLUDED.is_active,
           sort_order = EXCLUDED.sort_order
        `,
        [
          s.id,
          s.display_name || s.name || s.id,
          s.category || 'light',
          s.queue_type || 'api',
          s.credit_cost || 0,
          s.is_active === 1,
          s.sort_order || 0
        ]
      );
    }
    console.log(`Migrated ${sqliteServices.length} services.`);

    // 4. Map plan_services
    console.log('Re-creating plan_services mappings...');
    for (const plan of sqlitePlans) {
      let servicesList = [];
      try {
        servicesList = plan.services_json ? JSON.parse(plan.services_json) : [];
      } catch (e) {
        servicesList = [];
      }

      if (servicesList.includes('*')) {
        // Map all active services
        const allSvc = await pgClient.query('SELECT id FROM services');
        for (const s of allSvc.rows) {
          await pgClient.query(
            `INSERT INTO plan_services (plan_id, service_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [plan.id, s.id]
          );
        }
      } else {
        for (const sId of servicesList) {
          await pgClient.query(
            `INSERT INTO plan_services (plan_id, service_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [plan.id, sId]
          );
        }
      }
    }

    // 5. Migrate users
    console.log('Migrating users...');
    const sqliteUsers = await querySqlite('SELECT * FROM auth_users');
    const userIdMap = new Map(); // SQLite ID -> PostgreSQL UUID

    for (const u of sqliteUsers) {
      const pgUuid = crypto.randomUUID();
      userIdMap.set(u.id, pgUuid);

      // Map plan: SQLite standard/premium/free -> Postgres standard/premium/free
      let planId = u.subscription_plan || 'free';
      if (planId === 'standard') {
        planId = 'free'; // default standard to free/premium
      }

      await pgClient.query(
        `INSERT INTO users (
           id, channel, canonical_phone, is_active, name, plan_id, 
           credits, used_count, daily_count, expiry_date, 
           billing_cycle_start, last_daily_reset, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (canonical_phone) DO UPDATE SET
           channel = EXCLUDED.channel,
           is_active = EXCLUDED.is_active,
           name = EXCLUDED.name,
           plan_id = EXCLUDED.plan_id,
           credits = EXCLUDED.credits,
           used_count = EXCLUDED.used_count,
           daily_count = EXCLUDED.daily_count,
           expiry_date = EXCLUDED.expiry_date,
           billing_cycle_start = EXCLUDED.billing_cycle_start,
           last_daily_reset = EXCLUDED.last_daily_reset,
           updated_at = EXCLUDED.updated_at
         RETURNING id
        `,
        [
          pgUuid,
          u.channel || 'wa',
          u.canonical_phone,
          u.is_active === 1,
          u.name || '',
          planId,
          u.credits || 0,
          u.used_count || 0,
          u.daily_count || 0,
          parseDate(u.expiry_date),
          parseDate(u.billing_cycle_start) || new Date(),
          parseDate(u.last_daily_reset) || new Date(),
          parseDate(u.created_at) || new Date(),
          parseDate(u.updated_at) || new Date()
        ]
      );

      // Retrieve actual UUID if user already existed
      const existing = await pgClient.query('SELECT id FROM users WHERE canonical_phone = $1', [u.canonical_phone]);
      if (existing.rows.length > 0) {
        userIdMap.set(u.id, existing.rows[0].id);
      }
    }
    console.log(`Migrated ${sqliteUsers.length} users.`);

    // 6. Migrate user identities
    console.log('Migrating user identities...');
    const sqliteIdentities = await querySqlite('SELECT * FROM auth_user_identities');
    let identityCount = 0;
    for (const ident of sqliteIdentities) {
      const pgUserUuid = userIdMap.get(ident.auth_user_id);
      if (!pgUserUuid) {
        console.warn(`Warning: User ID ${ident.auth_user_id} for identity ${ident.id} not found in user map. Skipping.`);
        continue;
      }

      // No identities table in target PostgreSQL schema, wait! 
      // The PostgreSQL schema does not have auth_user_identities. The target schema stores channel and phone on the users table.
      // Wait, but to support telegram bot or alternate identities, let's check if the target schema needs user identities.
      // The 001_init.sql target schema did not include auth_user_identities because all users have single channel/canonical_phone.
      // Wait, is there a telegram identity? We can add a table if it exists, or just log.
      // Let's look at the target schema again. 001_init.sql does NOT have auth_user_identities.
      // But wait! Is it better to create it if it's used?
      // Yes, in `001_init.sql` we didn't define it. But let's check if we should add it or if the users table handles it.
      // The users table has: `id`, `channel`, `canonical_phone`, `is_active`, `name`.
      // The identity_value in SQLite is e.g. `<phone>@c.us` or `<tg_chat_id>`.
      // Let's create `auth_user_identities` table in PostgreSQL just in case it is used by Telegram/Whatsapp flow.
      // Wait, in `src/services/authorizationRepository.js` we see:
      // `await run('CREATE TABLE IF NOT EXISTS auth_user_identities (id TEXT PRIMARY KEY, auth_user_id TEXT, identity_type TEXT, identity_value TEXT UNIQUE, verified_at TEXT, last_seen_at TEXT, is_active INTEGER)');`
      // It is indeed used! We should make sure `auth_user_identities` is in our PG database, otherwise auth will fail when looking up identities!
      // Let's see if we should create `auth_user_identities` in Postgres.
      // Yes, we must create it! Let's alter the schema or run a query to create the table, and update 001_init.sql as well.
      // Let's create `auth_user_identities` table in our migration script and add it to 001_init.sql.
    }

    // Let's add auth_user_identities creation to the Postgres transaction
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS auth_user_identities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        identity_type VARCHAR(50) NOT NULL,
        identity_value VARCHAR(255) UNIQUE NOT NULL,
        verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      );
      CREATE INDEX IF NOT EXISTS idx_identities_user_fk ON auth_user_identities(auth_user_id);
    `);

    for (const ident of sqliteIdentities) {
      const pgUserUuid = userIdMap.get(ident.auth_user_id);
      if (!pgUserUuid) continue;

      await pgClient.query(
        `INSERT INTO auth_user_identities (auth_user_id, identity_type, identity_value, verified_at, last_seen_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (identity_value) DO UPDATE SET
           last_seen_at = EXCLUDED.last_seen_at,
           is_active = EXCLUDED.is_active
        `,
        [
          pgUserUuid,
          ident.identity_type,
          ident.identity_value,
          parseDate(ident.verified_at) || new Date(),
          parseDate(ident.last_seen_at) || new Date(),
          ident.is_active === 1
        ]
      );
      identityCount++;
    }
    console.log(`Migrated ${identityCount} user identities.`);

    // 7. Migrate verifications
    console.log('Migrating verifications...');
    // Create auth_verifications table in Postgres transaction if not exists
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS auth_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel VARCHAR(50) DEFAULT 'wa',
        canonical_phone VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        requested_by VARCHAR(255),
        requested_via VARCHAR(50) DEFAULT 'wa',
        expires_at TIMESTAMP WITH TIME ZONE,
        verified_at TIMESTAMP WITH TIME ZONE,
        verified_identity VARCHAR(255),
        meta_json JSONB DEFAULT '{}'::jsonb
      );
    `);

    const sqliteVerifs = await querySqlite('SELECT * FROM auth_verifications');
    for (const v of sqliteVerifs) {
      let meta = {};
      try {
        meta = v.meta_json ? JSON.parse(v.meta_json) : {};
      } catch (e) {
        meta = {};
      }

      await pgClient.query(
        `INSERT INTO auth_verifications (
           channel, canonical_phone, code, status, requested_by, requested_via, 
           expires_at, verified_at, verified_identity, meta_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          v.channel || 'wa',
          v.canonical_phone,
          v.code,
          v.status || 'pending',
          v.requested_by,
          v.requested_via || 'wa',
          parseDate(v.expires_at),
          parseDate(v.verified_at),
          v.verified_identity,
          JSON.stringify(meta)
        ]
      );
    }
    console.log(`Migrated ${sqliteVerifs.length} verifications.`);

    // 8. Migrate credit transactions
    console.log('Migrating credit transactions...');
    const sqliteTxns = await querySqlite('SELECT * FROM credit_transactions');
    for (const t of sqliteTxns) {
      const pgUserUuid = userIdMap.get(t.user_id);
      if (!pgUserUuid) continue;

      await pgClient.query(
        `INSERT INTO credit_transactions (
           user_id, action, amount, balance_before, balance_after, note, triggered_by, job_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          pgUserUuid,
          t.action,
          t.amount,
          t.balance_before || 0,
          t.balance_after || 0,
          t.note || '',
          t.triggered_by || 'admin',
          t.job_id || '',
          parseDate(t.created_at) || new Date()
        ]
      );
    }
    console.log(`Migrated ${sqliteTxns.length} credit transactions.`);

    // 9. Migrate jobs
    console.log('Migrating jobs...');
    const sqliteJobs = await querySqlite('SELECT * FROM jobs');
    for (const j of sqliteJobs) {
      const pgUserUuid = userIdMap.get(j.user_id);
      let payload = {};
      let result = {};
      try {
        payload = j.payload_json ? JSON.parse(j.payload_json) : {};
      } catch (e) {}
      try {
        result = j.result_json ? JSON.parse(j.result_json) : {};
      } catch (e) {}

      await pgClient.query(
        `INSERT INTO jobs (
           id, user_id, user_phone, queue_type, command, payload, status, result, 
           error_text, chat_id, transport, priority, created_at, started_at, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO NOTHING
        `,
        [
          j.id,
          pgUserUuid || null,
          j.user_phone,
          j.queue_type,
          j.command,
          JSON.stringify(payload),
          j.status || 'pending',
          JSON.stringify(result),
          j.error_text || '',
          j.chat_id,
          j.transport || 'wa',
          j.priority || 0,
          parseDate(j.created_at) || new Date(),
          parseDate(j.started_at),
          parseDate(j.completed_at)
        ]
      );
    }
    console.log(`Migrated ${sqliteJobs.length} jobs.`);

    // 10. Migrate tracked applications from JSON files
    console.log('Migrating tracked applications from JSON files...');
    const dlTrackPath = 'data/tracked_applications.json';
    const vahanTrackPath = 'data/vahan_tracked_applications.json';

    let trackedCount = 0;

    if (fs.existsSync(dlTrackPath)) {
      try {
        const dlTracked = JSON.parse(fs.readFileSync(dlTrackPath, 'utf8'));
        for (const app of dlTracked) {
          // Find user by phone in PG database
          const phone = app.chatId.split('@')[0];
          const userRes = await pgClient.query('SELECT id FROM users WHERE canonical_phone = $1', [phone]);
          const pgUserUuid = userRes.rows[0] ? userRes.rows[0].id : null;

          if (!pgUserUuid) {
            console.warn(`Warning: User with phone ${phone} not found for tracked app ${app.appNo}. Skipping.`);
            continue;
          }

          let snapshot = {};
          try {
            snapshot = app.lastSnapshot ? (typeof app.lastSnapshot === 'string' ? JSON.parse(app.lastSnapshot) : app.lastSnapshot) : {};
          } catch (e) {}

          await pgClient.query(
            `INSERT INTO tracked_applications (
               user_id, app_number, app_type, chat_id, transport, last_snapshot, last_checked_at, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (app_number) DO NOTHING
            `,
            [
              pgUserUuid,
              app.appNo,
              'sarathi',
              app.chatId,
              app.transport || 'wa',
              JSON.stringify(snapshot),
              parseDate(app.lastCheckedAt) || new Date(),
              parseDate(app.createdAt) || new Date()
            ]
          );
          trackedCount++;
        }
      } catch (e) {
        console.error('Error migrating DL tracked applications:', e.message);
      }
    }

    if (fs.existsSync(vahanTrackPath)) {
      try {
        const vahanTracked = JSON.parse(fs.readFileSync(vahanTrackPath, 'utf8'));
        for (const app of vahanTracked) {
          const phone = app.chatId.split('@')[0];
          const userRes = await pgClient.query('SELECT id FROM users WHERE canonical_phone = $1', [phone]);
          const pgUserUuid = userRes.rows[0] ? userRes.rows[0].id : null;

          if (!pgUserUuid) {
            console.warn(`Warning: User with phone ${phone} not found for tracked Vahan app ${app.applicationNumber}. Skipping.`);
            continue;
          }

          let snapshot = {};
          try {
            snapshot = app.lastSnapshot ? (typeof app.lastSnapshot === 'string' ? JSON.parse(app.lastSnapshot) : app.lastSnapshot) : {};
          } catch (e) {}

          await pgClient.query(
            `INSERT INTO tracked_applications (
               user_id, app_number, app_type, chat_id, transport, last_snapshot, last_checked_at, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (app_number) DO NOTHING
            `,
            [
              pgUserUuid,
              app.applicationNumber,
              'vahan',
              app.chatId,
              app.transport || 'wa',
              JSON.stringify(snapshot),
              parseDate(app.lastCheckedAt) || new Date(),
              parseDate(app.createdAt) || new Date()
            ]
          );
          trackedCount++;
        }
      } catch (e) {
        console.error('Error migrating Vahan tracked applications:', e.message);
      }
    }
    console.log(`Migrated ${trackedCount} tracked applications.`);

    // 11. Commit PG transaction
    await pgClient.query('COMMIT');
    console.log('Migration committed successfully!');
  } catch (err) {
    await pgClient.query('ROLLBACK');
    console.error('Migration failed and was rolled back:', err.message);
    throw err;
  } finally {
    pgClient.release();
    sqliteDb.close();
    await pgPool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration execution failed:', err);
  process.exit(1);
});
