# Sarathi WA Bot — PostgreSQL Schema & Data Access Layer Audit

**Auditor:** Database Optimizer  
**Date:** 2026-06-06  
**Scope:** Read-only audit of schema, SQLite→PG conversion layer, query patterns, and data access repositories.  

---

## 1. Schema Completeness — Missing Indexes, Foreign Keys, Constraints

### 1.1 Verified Tables (13 tables present in 001_init.sql)
| # | Table | PK | Has FK Index? | Notes |
|---|-------|----|---------------|-------|
| 1 | `subscription_plans` | `id VARCHAR` | N/A | ✅ |
| 2 | `services` | `id VARCHAR` | N/A | ✅ |
| 3 | `plan_services` | `UUID (gen_random_uuid)` | ❌ **Missing index on `plan_id` and `service_id`** | See 1.2 |
| 4 | `auth_users` | `UUID (gen_random_uuid)` | ❌ **Missing index on `plan_id`** | FK to subscription_plans |
| 5 | `auth_user_identities` | `UUID` | ✅ `idx_identities_user_fk` exists | Good |
| 6 | `auth_verifications` | `UUID` | ❌ **No index on `(canonical_phone, status, expires_at)`** | Queried by this in `getPendingVerification()`, `hasPendingVerification()` |
| 7 | `authorized_groups` | `UUID` | ❌ **No index on `(channel, is_active)`** | Queried in `getAuthorizedGroups()` |
| 8 | `credit_transactions` | `UUID` | ✅ `idx_credit_tx_user` exists | Good |
| 9 | `jobs` | `VARCHAR(255)` | ✅ `idx_jobs_status`, `idx_jobs_user_status`, `idx_jobs_queue_status` | Good |
| 10 | `rate_limit_log` | `UUID` | ✅ `idx_rate_log_user`, `idx_rate_log_cat` | Good |
| 11 | `tracked_applications` | `UUID` | ✅ `idx_tracked_applications_chat`, `idx_tracked_applications_app` | Good |
| 12 | `payment_requests` | `UUID` | ✅ `idx_payment_req_status` | Good |
| 13 | `service_price_overrides` | `UUID` | ✅ `idx_service_price_overrides_lookup` | Good |
| 14 | `ai_layout_mappings` | `VARCHAR` | ❌ **No indexes at all** | Table exists in 001_init but NOT created in `initDb()` — see 1.4 |

### 1.2 Missing Critical Indexes

**HIGH PRIORITY — `plan_services` joining:**
```sql
-- Missing: auto-index on composite PK covers plan_id + service_id for equality
-- OK for UNIQUE(plan_id, service_id) — composite unique index serves both columns.
```
Actually, the `UNIQUE(plan_id, service_id)` constraint creates a B-tree index on `(plan_id, service_id)`, which covers lookups by `plan_id` alone (leftmost prefix). So this is **OK**.

**HIGH PRIORITY — `auth_users.plan_id`:**
- Foreign key `plan_id VARCHAR(255) REFERENCES subscription_plans(id)` exists but has **NO index**.
- Queried in `getUserPlan()` → `SELECT COALESCE(plan_id, ...) FROM auth_users WHERE id = ?` — uses PK, OK.
- But `listAllUsers()` GROUP BY includes `u.id` which uses PK, so this is indirect.
- **Risk**: Admin dashboard queries filtering users by `plan_id` would seq scan.

**HIGH PRIORITY — `auth_verifications` lookup path:**
- `getPendingVerification(phone, code)` queries: `WHERE canonical_phone = ? AND code = ? AND status = 'pending' AND expires_at > NOW()`
- `hasPendingVerification(phone)` queries: `WHERE canonical_phone = ? AND status = 'pending' AND expires_at > NOW() LIMIT 1`
- **No index on `(canonical_phone)` or `(canonical_phone, status, expires_at)`**.
- At scale (>10K rows), these become sequential scans.

**MEDIUM PRIORITY — `authorized_groups`:**
- `getAuthorizedGroups(channel)` queries: `WHERE channel = ? AND is_active = 1`
- **No index** — requires seq scan on the full table.

**LOW PRIORITY — `rate_limit_log` query for `getActivityLog()`:**
- Query: `SELECT * FROM rate_limit_log WHERE 1=1 AND ... ORDER BY timestamp DESC LIMIT ?`
- `idx_rate_log_user(user_id, timestamp)` covers user-based lookups but NOT category-only or date-range-only queries.
- The `idx_rate_log_cat(user_id, category, timestamp)` covers user+category, but not category alone.
- When querying just by `category` or just by `from`/`to` date range without userId, sequential scan is unavoidable.

### 1.3 Missing Constraints

1. **`auth_users` / `credit_transactions` — `credits` should be `INTEGER NOT NULL DEFAULT 0` with `CHECK (credits >= 0)`**
   - Current: `credits INTEGER DEFAULT 0` — allows NULL (queries use `COALESCE`).
   - No CHECK constraint prevents negative values.
   - Code enforces `Math.max(0, before - n)` but a CHECK is defense-in-depth.

2. **`credit_transactions.amount` — no CHECK constraint**
   - `amount INTEGER NOT NULL` — allows negative amounts.
   - Code uses `Math.max(0, Number(amount) || 0)` but DB-level integrity is missing.

3. **`credit_transactions.balance_after` — no CHECK (balance_after >= 0)**
   - `balance_after INTEGER NOT NULL` — no constraint ensures non-negative.  
   - Code enforces `Math.max(0, before - n)` but race conditions could bypass.

4. **`jobs.status` — no CHECK constraint**
   - `status VARCHAR(50) DEFAULT 'pending'` — any string allowed.
   - Application only uses: `pending`, `running`, `completed`, `failed`, `cancelled`.

5. **`payment_requests.amount` — no CHECK (amount >= 0)**

6. **`service_price_overrides.credit_cost` — no CHECK (credit_cost >= 0)**

### 1.4 Schema Drift: 001_init.sql vs initDb()

Three tables are defined in `001_init.sql` but **NOT created by `initDb()`** in `authorizationRepository.js`:
- `tracked_applications` — created separately by `trackingRepository.createSchema()` with advisory lock `987654322`.
- `payment_requests` — created in `initDb()` ✅ (no, wait — let me recheck...)
- `ai_layout_mappings` — **NOT created in `initDb()` at all**. It exists only in 001_init.sql.

Also: `initDb()` does NOT create `idx_tracked_applications_chat` and `idx_tracked_applications_app` — those are created in `trackingRepository.createSchema()`.
And: `initDb()` does NOT create `idx_tracked_applications_*` or `idx_payment_req_status` — wait, let me recheck...

Looking at `initDb()` (authorizationRepository.js lines 220-228):
```javascript
await run('CREATE INDEX IF NOT EXISTS idx_identities_user_fk ON auth_user_identities(auth_user_id)');
await run('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)');
await run('CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status)');
await run('CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue_type, status)');
await run('CREATE INDEX IF NOT EXISTS idx_rate_log_user ON rate_limit_log(user_id, timestamp)');
await run('CREATE INDEX IF NOT EXISTS idx_rate_log_cat ON rate_limit_log(user_id, category, timestamp)');
await run('CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at)');
await run('CREATE INDEX IF NOT EXISTS idx_payment_req_status ON payment_requests(status)');
await run('CREATE INDEX IF NOT EXISTS idx_service_price_overrides_lookup ON service_price_overrides(scope_type, scope_id, service_id, is_active)');
```

So `initDb()` does NOT create:
- `idx_tracked_applications_chat` (created by trackingRepository)
- `idx_tracked_applications_app` (created by trackingRepository)
- `ai_layout_mappings` table itself — this is only in the migration SQL, never created by code

---

## 2. SQLite→PG Conversion Layer (db.js) — Regex Transform Analysis

### 2.1 `?` → `$N` Placeholder Rewrite (line 53-54)
```javascript
converted = converted.replace(/\?/g, () => `$${++paramIndex}`);
```
**Risk: Question marks in string literals are also replaced.**
- Example: If SQL contains `'?'` or `WHERE name = 'what?'`, the `?` inside the string literal gets replaced with `$N`.
- This would corrupt the SQL and potentially cause syntax errors or wrong results.
- In practice, the codebase uses parameterized queries consistently, so all `?` should be placeholders. But this is a brittle assumption.

### 2.2 `PRAGMA table_info` → information_schema (lines 57-60)
```javascript
if (/pragma\s+table_info\((tracked_sarathi|tracked_vahan)\)/i.test(converted)) {
    const tableName = converted.match(/pragma\s+table_info\((tracked_sarathi|tracked_vahan)\)/i)[1];
    return `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${tableName}'`;
}
```
**CRITICAL: SQL injection via table name is NOT relevant here** (regex capture is hardcoded), but the result is a static string without proper quoting — fine since table names are hardcoded in the regex.

**However**: `tracked_sarathi` and `tracked_vahan` tables no longer exist — they were merged into `tracked_applications`. If any code still calls `PRAGMA table_info(tracked_sarathi)`, the PG conversion will query `information_schema.columns WHERE table_name = 'tracked_sarathi'` which returns empty since the table doesn't exist.

### 2.3 General PRAGMA → `SELECT 1` (lines 63-65)
```javascript
if (/^\s*pragma\s+/i.test(converted)) {
    return 'SELECT 1';
}
```
Any SQLite PRAGMA statement becomes a no-op. This silently discards functionality. If a PRAGMA like `PRAGMA journal_mode=WAL` or `PRAGMA foreign_keys=ON` was important, it's now gone with no warning.

### 2.4 `GROUP_CONCAT` → `STRING_AGG` (lines 68-71)
```javascript
converted = converted.replace(/group_concat\((distinct\s+)?([^)]+)\)/gi, ...);
```
**Risk: Nested parentheses break the regex.**
- `GROUP_CONCAT(DISTINCT i.identity_value)` → `STRING_AGG(DISTINCT i.identity_value, ',')` ✅ works
- `GROUP_CONCAT(DISTINCT COALESCE(i.name, ''))` → regex `([^)]+)` would match only `COALESCE(i.name, ''` (up to first `)`), resulting in malformed SQL.
- **Current codebase only uses simple expressions**, but this is a fragile regex.

### 2.5 `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING` (lines 74-86)
```javascript
converted = converted.replace(/insert\s+or\s+ignore\s+into/gi, 'INSERT INTO');
if (tableName.toLowerCase() === 'tracked_sarathi') {
    converted += ' ON CONFLICT (app_no, chat_id, transport) DO NOTHING';
}
```
**CRITICAL**: The `tracked_sarathi` conflict target `(app_no, chat_id, transport)` references columns that DON'T EXIST in the new `tracked_applications` table. The actual column is `app_number`, not `app_no`. This produces:
```sql
INSERT INTO tracked_applications (...) VALUES (...)
ON CONFLICT (app_no, chat_id, transport) DO NOTHING
-- ERROR: column "app_no" does not exist
```
Similarly, the tracked_vahan path references `application_number` — the tracked_applications table uses `app_number` consistently.

### 2.6 `INSERT OR REPLACE` / `REPLACE INTO` → `ON CONFLICT DO UPDATE` (lines 89-102)
Same issue: conflict targets reference `tracked_sarathi` columns like `app_no` and `last_stage` that don't match the unified `tracked_applications` schema. The tracked_applications table uses `app_number` and stores stage info in `meta_json`.

### 2.7 `datetime()` → Interval Conversion (lines 105-108)
```javascript
converted = converted.replace(/datetime\('now',\s*'([^']+)'\)/gi, "NOW() + '$1'::interval");
```
**Risk**: This works for simple intervals like `'-30 days'` but would break for complex expressions like `datetime('now', 'start of month', '+1 month', '-1 day')`. The current codebase only uses `'-30 days'`, so it's safe now, but fragile.

### 2.8 RETURNING id — Generic Append (lines 131-136)
```javascript
if (/^\s*insert\s+/i.test(querySql) && !/returning/i.test(querySql)) {
    querySql += ' RETURNING id';
}
```
**Risk for jobs table**: `jobs.id` is `VARCHAR(255) PRIMARY KEY` (prefixed with `job_`), not UUID. The `RETURNING id` will return the varchar PK, which is correct. The `lastID` return value is the PK as a string. **This works correctly.**

**Risk for `rate_limit_log`**: `rate_limit_log.id` is `UUID` — works fine.

**Risk for `service_price_overrides.upsertOverride()`**: This `run()` call does NOT need `RETURNING id` since it then does a separate SELECT query. The `returning id` is harmless extra data.

### 2.9 `excluded.` → `EXCLUDED.` Case Correction (line 114)
```javascript
converted = converted.replace(/\bexcluded\./gi, 'EXCLUDED.');
```
✅ Correct and safe — handles case-insensitive normalization.

---

## 3. Advisory Lock Pattern Analysis

### 3.1 authorizationRepository.initDb() — Advisory Lock 987654321

```javascript
for (let i = 0; i < 10; i++) {
    const [r] = await query('SELECT pg_try_advisory_lock(987654321) AS ok');
    if (r && r.ok) { lockAcquired = true; break; }
    await new Promise(res => setTimeout(res, 500));
}
```

**✅ ISSUE: `pg_try_advisory_lock()` returns a boolean, but PostgreSQL returns it as a boolean type.**
Actually, `pg_try_advisory_lock()` returns `boolean` — this is correctly checked with `r.ok`. The `AS ok` alias is fine.

**✅ Issue: Retry loop waits up to 5 seconds (10 × 500ms).** This is reasonable.

**✅ Issue: Lock IS released in the `finally` block** — correct pattern to avoid deadlocks.

**⚠️ Issue: Lock key `987654321` is a hardcoded magic number. If another part of the system uses the same key, it could cause contention.** However, the only other advisory lock is `987654322` in `trackingRepository.js`.

### 3.2 trackingRepository.createSchema() — Advisory Lock 987654322

```javascript
await query('SELECT pg_advisory_lock(?)', [TRACKING_SCHEMA_LOCK_ID]);
```

**⚠️ Issue: Uses `pg_advisory_lock()` (blocking) vs `pg_try_advisory_lock()` (non-blocking).**
This is a blocking lock, which could cause a deadlock if the process crashes while holding the lock (the lock is session-level). The `finally` block ensures unlock is called, but if the process terminates abnormally, the lock is released automatically by PG when the session disconnects. **This is acceptable** — blocking is fine for schema creation.

**⚠️ Issue: The `?` placeholder is used with `pg_advisory_lock(?)`.** The conversion layer replaces `?` with `$1` correctly. The param `TRACKING_SCHEMA_LOCK_ID = 987654322` is passed separately. **This is correct.**

### 3.3 Verdict: Advisory Lock Pattern

- Both locks are properly released in `finally` blocks.
- Lock keys are unique (`987654321` and `987654322`) — no collision.
- Both containers would compete but only one proceeds.
- **Risk**: The retry loop in `initDb()` silently gives up after 5 seconds if it can't acquire the lock. If the lock is held by a long-running init process, the second container fails to initialize and throws an error — which is caught and logged as `[authRepo] Database initialization failed`. This could cause the second container to start without tables. However, the `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` patterns in subsequent calls should be safe because they are idempotent (PostgreSQL handles concurrent DDL with its own locking).

**Verdict:** ✅ Acceptable with minor reservations about the 5-second timeout.

---

## 4. FOR UPDATE Row Locks in Credit Transactions

### 4.1 All credit operations are properly wrapped in `runTransaction()` with FOR UPDATE:

| Function | Transaction | FOR UPDATE | Correct |
|----------|------------|------------|---------|
| `addCreditsAudited()` | ✅ `runTransaction` | ✅ `SELECT credits ... FOR UPDATE` | ✅ |
| `setCreditsAudited()` | ✅ `runTransaction` | ✅ `SELECT credits ... FOR UPDATE` | ✅ |
| `deductCreditsAudited()` | ✅ `runTransaction` | ✅ `SELECT credits ... FOR UPDATE` | ✅ |
| `reserveCreditsForJob()` | ✅ `runTransaction` | ✅ `SELECT credits, reserved_credits ... FOR UPDATE` | ✅ |
| `finalizeReservedCreditsForJob()` | ✅ `runTransaction` | ✅ `SELECT credits, reserved_credits ... FOR UPDATE` | ✅ |
| `releaseReservedCreditsForJob()` | ✅ `runTransaction` | ✅ `SELECT reserved_credits ... FOR UPDATE` | ✅ |

### 4.2 Non-transactional credit operations (NO FOR UPDATE):

| Function | Transaction | Risk |
|----------|------------|------|
| `addCredits()` (line 458) | ❌ No — calls `addCreditsAudited()` | ✅ Actually, `addCreditsAudited()` uses transaction |
| `setCredits()` (line 459) | ❌ No — calls `setCreditsAudited()` | ✅ Same — inner function uses transaction |
| `getCredits()` (line 454) | ❌ No | 🟡 Read without lock — could read slightly stale data. Acceptable for display purposes. |
| `incrementUsage()` (line 441) | ❌ No | ⚠️ Race condition on `used_count` and `daily_count` — concurrent increments could lose updates. Uses `COALESCE(used_count,0)+1` which is atomic per statement, but in READ COMMITTED isolation, two concurrent calls could both read the same value and write the same +1 result. |
| `getCreditHistory()` (line 557) | ❌ No | ✅ Read-only, acceptable |

### 4.3 Verdict

All financial credit transactions (add, deduct, set, reserve, finalize, release) are **properly protected with transactions and FOR UPDATE row locks**. This is correct and prevents race conditions on balances.

The **`incrementUsage()`** function is a mild concern — concurrent requests could lose count increments, but this is usage statistics, not financial data.

---

## 5. Rate Limit Query Performance at Scale

### 5.1 `_loadCounts()` in rateLimiter.js — 4 separate COUNT(*) queries

```sql
SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light';
SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium';
SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light';
SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium';
```

These split into day/month variants (2 × light, 2 × medium).

**Index coverage**: `idx_rate_log_cat(user_id, category, timestamp)` covers all four queries perfectly:
- `user_id` + `category` + `timestamp >= ?` — all columns are in the index; PostgreSQL can do an Index Only Scan.

**Performance at 10K rows per user**: Excellent — index-only scans are fast.
**Performance at 100K+ rows per user**: Still good — the index is selective (by user_id).

### 5.2 `getActivityLog()` in authorizationRepository.js

```sql
SELECT * FROM rate_limit_log WHERE 1=1 AND [filters] ORDER BY timestamp DESC LIMIT ?
```

- **No index on `timestamp` alone** — when querying without userId but with date range, this falls back to seq scan.
- The `ORDER BY timestamp DESC LIMIT N` is best served by an index on `(timestamp DESC)` — currently missing.

### 5.3 `/rate-limits/usage/:userId` in adminRouter.js — 6 COUNT(*) queries

This endpoint runs **6 separate COUNT(*) queries** for light/medium/heavy × day/month:
```sql
SELECT COUNT(*) FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light'
SELECT COUNT(*) FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium'
SELECT COUNT(*) FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='heavy'
SELECT COUNT(*) FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light'
SELECT COUNT(*) FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium'
SELECT COUNT(*) FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='heavy'
```

**Optimization opportunity**: These 6 queries can be combined into a single query:
```sql
SELECT category,
       COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '24 hours') AS day_count,
       COUNT(*) FILTER (WHERE timestamp >= NOW() - INTERVAL '30 days') AS month_count
FROM rate_limit_log
WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'
GROUP BY category;
```
This reduces 6 round-trips to 1.

### 5.4 Verdict

The index `idx_rate_log_cat(user_id, category, timestamp)` is well-designed and covers the main rate-limit check queries. The main concern is the **6-query explosion** in `_loadCounts()` + admin endpoint, which is 4-6 round trips when 1 would suffice.

---

## 6. JOIN Patterns — Correctness and Performance

### 6.1 `listAllUsers()` (line 361-372)

```sql
SELECT u.*, COALESCE(u.plan_id, 'free') AS subscription_plan,
       STRING_AGG(DISTINCT i.identity_value, ',') AS identities,
       v.code AS pending_otp
FROM auth_users u
LEFT JOIN auth_user_identities i ON u.id = i.auth_user_id AND i.is_active = 1
LEFT JOIN auth_verifications v ON u.canonical_phone = v.canonical_phone AND v.status = 'pending' AND v.expires_at > CURRENT_TIMESTAMP
WHERE u.is_active = 1
GROUP BY u.id, v.code
ORDER BY u.created_at DESC
```

**Performance Issues:**
1. **GROUP BY on u.id + v.code**: If a user has multiple pending verifications, this creates separate rows per verification code, which is then coalesced by `STRING_AGG`. However, the LEFT JOIN to `auth_verifications` with conditions `v.status = 'pending' AND v.expires_at > NOW()` means at most one active verification per phone (typically). So this is **acceptable but fragile** — if somehow two pending verifications exist, the user appears in multiple result rows.

2. **Missing index on `auth_verifications(canonical_phone, status, expires_at)`**: The join condition filters by all three columns, but there is no covering index. This causes a seq scan.

3. **`u.*`**: Returns all columns of `auth_users` plus `COALESCE(u.plan_id, 'free')` as `subscription_plan`. The `*` is problematic — it's wide and returns unnecessary columns.

### 6.2 `getUsersWithSpentCredits()` (line 608-621)

```sql
SELECT u.*, COALESCE(u.plan_id, 'free') AS subscription_plan,
       COALESCE(
         (SELECT SUM(ct.amount) FROM credit_transactions ct WHERE ct.user_id = u.id AND ct.action = 'deduct'),
         0
       ) AS credits_spent,
       STRING_AGG(DISTINCT i.identity_value, ',') AS identities,
       v.code AS pending_otp
FROM auth_users u
LEFT JOIN auth_user_identities i ON u.id = i.auth_user_id AND i.is_active = 1
LEFT JOIN auth_verifications v ON u.canonical_phone = v.canonical_phone AND v.status = 'pending' AND v.expires_at > CURRENT_TIMESTAMP
WHERE u.is_active = 1
GROUP BY u.id, v.code
ORDER BY u.created_at DESC
```

**Critical Performance Problem**: The correlated subquery `(SELECT SUM(ct.amount) FROM credit_transactions ct WHERE ct.user_id = u.id AND ct.action = 'deduct')` executes **once per user row**. For 1000 users, this is 1000 separate index lookups. The index `idx_credit_tx_user(user_id, created_at)` covers the subquery partially — but `created_at` is not needed, only `user_id` and `action`. This is an **N+1 with a correlated subquery**.

**Better approach**: Use a lateral join or a separate aggregation:
```sql
SELECT u.*,
       COALESCE(ct_stats.credits_spent, 0) AS credits_spent,
       ...
FROM auth_users u
LEFT JOIN LATERAL (
    SELECT SUM(amount) AS credits_spent
    FROM credit_transactions
    WHERE user_id = u.id AND action = 'deduct'
) ct_stats ON true
...
```

Or better yet, pre-aggregate:
```sql
WITH credit_spent AS (
    SELECT user_id, SUM(amount) AS credits_spent
    FROM credit_transactions
    WHERE action = 'deduct'
    GROUP BY user_id
)
SELECT u.*, COALESCE(cs.credits_spent, 0) AS credits_spent, ...
FROM auth_users u
LEFT JOIN credit_spent cs ON cs.user_id = u.id
...
```

### 6.3 `getPendingPaymentRequests()` and `getAllPaymentRequests()`

```sql
SELECT p.*, u.canonical_phone, u.name AS user_name
FROM payment_requests p
LEFT JOIN auth_users u ON p.user_id = u.id
WHERE p.status = 'pending'
ORDER BY p.created_at DESC
```

- **Missing index on `payment_requests(user_id)`** — FK join to auth_users. The `idx_payment_req_status` covers `status`, but the join to `auth_users` via `user_id` has no index.

---

## 7. Missing Indexes Summary

| Table | Query Pattern | Missing Index | Priority |
|-------|---------------|---------------|----------|
| `auth_verifications` | `WHERE canonical_phone=? AND code=? AND status='pending' AND expires_at>NOW()` | `(canonical_phone, status, expires_at)` or `(canonical_phone, code, status, expires_at)` | **HIGH** |
| `auth_verifications` | `hasPendingVerification()` | Same as above | **HIGH** |
| `authorized_groups` | `WHERE channel=? AND is_active=1` | `(channel, is_active)` | **MEDIUM** |
| `payment_requests` | JOIN to `auth_users` on `user_id` | `(user_id)` | **MEDIUM** |
| `credit_transactions` | Subquery: `WHERE user_id=? AND action='deduct'` | `(user_id, action)` — current index is `(user_id, created_at)` which covers partially | **LOW** |
| `rate_limit_log` | `ORDER BY timestamp DESC LIMIT N` | `(timestamp DESC)` — for cleanup queries and unbounded date-range queries | **LOW** |
| `auth_users` | FK to `subscription_plans` | `(plan_id)` | **LOW** |

---

## 8. Migration Versioning

### 8.1 There is NO migration tracking system

- No `schema_migrations` or `_migrations` table.
- No migration version numbers.
- No `down` migrations.
- No migration runner/migrator library (e.g., `node-pg-migrate`, `knex`).

### 8.2 Current "Migration Strategy"

The system uses **ad-hoc schema initialization** via `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` + `addColumnIfMissing()`:
- `authorizationRepository.initDb()` creates all tables and indexes inline.
- `trackingRepository.createSchema()` creates tracked_applications separately.
- `pricingRepository.ensureTable()` creates service_price_overrides (duplicate of initDb).

### 8.3 Problems

1. **No controlled schema evolution**: Schema changes are done by adding `addColumnIfMissing()` calls in `initDb()` (line 100-102):
   ```javascript
   await addColumnIfMissing('auth_users', 'plan_id', "VARCHAR(255) REFERENCES subscription_plans(id) ON DELETE SET NULL");
   await addColumnIfMissing('auth_users', 'rate_limit_overrides', "JSONB DEFAULT '{}'::jsonb");
   await addColumnIfMissing('auth_users', 'reserved_credits', 'INTEGER DEFAULT 0');
   ```
   These are ad-hoc — there's no record of which migrations have been applied.

2. **Duplicate table creation**: `service_price_overrides` is created in `initDb()` AND in `pricingRepository.ensureTable()`. Since both use `CREATE TABLE IF NOT EXISTS`, it's idempotent but wasteful.

3. **`ai_layout_mappings` table orphan**: Created in migration SQL but never in `initDb()`. If the migration SQL is not run separately, this table doesn't exist.

4. **`addColumnIfMissing()` has TOCTOU race**: The `SELECT 1 FROM information_schema.columns WHERE ... LIMIT 1` and the subsequent `ALTER TABLE ADD COLUMN` are separate operations. Two concurrent containers could both pass the check and both attempt the ALTER TABLE — one would fail with "column already exists". This is caught by the error handler but is not clean.

---

## 9. N+1 Query Patterns in adminRouter.js

### 9.1 Found: Correlated Subquery in `getUsersWithSpentCredits()` (Severity: HIGH)

As analyzed in §6.2, the correlated subquery for `credits_spent` runs per user row:
```sql
COALESCE(
  (SELECT SUM(ct.amount) FROM credit_transactions ct WHERE ct.user_id = u.id AND ct.action = 'deduct'),
  0
) AS credits_spent
```
For 1000 users on the admin dashboard bootstrap, this adds 1000 extra index lookups.

**Impact**: Every admin page load that calls `/bootstrap`, `/users`, or `/stats/summary` executes this correlated subquery. At 1000+ users, response time increases noticeably.

### 9.2 Found: `getJobStats()` — 6 separate COUNT(*) queries

```javascript
const [total] = await query('SELECT COUNT(*) AS c FROM jobs');
const [pending] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'pending'");
const [running] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'running'");
const [completed] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'completed'");
const [failed] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed'");
const [today] = await query('SELECT COUNT(*) AS c FROM jobs WHERE created_at >= ?', [...]);
const [todayDone] = await query("SELECT COUNT(*) AS c FROM jobs WHERE status = 'completed' AND created_at >= ?", [...]);
```

This is **7 separate queries** when it could be 1-2:
```sql
SELECT status, COUNT(*) AS c
FROM jobs
GROUP BY status;  -- single query gives all 5 status counts

SELECT COUNT(*) FILTER (WHERE created_at >= $1) AS today,
       COUNT(*) FILTER (WHERE status = 'completed' AND created_at >= $1) AS today_done
FROM jobs;
```

Reduces 7 round-trips to 2.

### 9.3 Found: `/rate-limits/usage/:userId` — 6 COUNT(*) queries

As analyzed in §5.3, this endpoint runs 6 separate COUNT queries for light/medium/heavy × day/month. Same optimization opportunity — 1 query using `GROUP BY category`.

### 9.4 Found: `getAllPlans()` with `getPlanServices()` per plan

```javascript
async function getAllPlans() {
  const rows = await query('SELECT * FROM subscription_plans ORDER BY created_at DESC');
  const plans = [];
  for (const row of rows) plans.push(normalizePlan(row, await getPlanServices(row.id)));
  return plans;
}
```

This is an **N+1**: For each plan, `getPlanServices()` executes a separate SELECT query. If there are 10 plans, that's 10 extra queries.

**Optimization**: Batch-load all services in one query:
```sql
SELECT plan_id, service_id FROM plan_services ORDER BY plan_id, service_id;
```
Then group by `plan_id` in application code.

### 9.5 No N+1 Found: `/bootstrap` endpoint

The bootstrap endpoint correctly uses `Promise.all()` to run independent queries concurrently:
```javascript
const [users, waGroups, tgGroups, totalCreditsSpent, services, priceOverrides, apiStats, browserStats] = await Promise.all([
  authRepo.getUsersWithSpentCredits(),
  authRepo.getAuthorizedGroups('wa'),
  ...
]);
```
This is good — parallel execution, not sequential.

---

## 10. Data Type Mismatches

### 10.1 JSONB vs TEXT

| Field | Schema Type | Usage | Verdict |
|-------|-------------|-------|---------|
| `subscription_plans.limits_json` | `JSONB` | ✅ Correct — `JSON.parse()` and `?::jsonb` cast used | ✅ |
| `auth_users.rate_limit_overrides` | `JSONB` | ✅ Correct — `JSON.parse()` and `?::jsonb` used | ✅ |
| `auth_verifications.meta_json` | `JSONB` | ✅ | ✅ |
| `jobs.payload` | `JSONB` | ✅ Correct — `?::jsonb` casts used | ✅ |
| `jobs.result` | `JSONB` | ✅ | ✅ |
| `tracked_applications.last_snapshot` | `JSONB` | ✅ Correct — serialized as `{ text: ... }` | ✅ |
| `tracked_applications.meta_json` | `JSONB` | ✅ | ✅ |
| `ai_layout_mappings.mapping_rules` | `TEXT` | ❌ **Why TEXT and not JSONB?** If this stores JSON, it should be JSONB. The table is orphaned anyway. | ⚠️ |

### 10.2 INTEGER vs BIGINT

| Field | Type | Current Max Value | Issue |
|-------|------|-------------------|-------|
| `auth_users.credits` | `INTEGER` | By default, INTEGER is int4 (max ~2.1B). If credits represent paise/cents, 2.1B = ₹21Cr — unlikely, safe | ✅ |
| `auth_users.reserved_credits` | `INTEGER` | Same | ✅ |
| `auth_users.used_count` | `INTEGER` | Max 2.1B — safe for usage counters | ✅ |
| `auth_users.daily_count` | `INTEGER` | Max 2.1B — safe | ✅ |
| `credit_transactions.amount` | `INTEGER` | Max 2.1B — safe | ✅ |
| `credit_transactions.balance_before/after` | `INTEGER` | Max 2.1B — safe | ✅ |
| `payment_requests.amount` | `INTEGER` | Max 2.1B — safe | ✅ |
| `service_price_overrides.credit_cost` | `INTEGER` | Max 2.1B — safe | ✅ |
| `services.credit_cost` | `INTEGER` | Max 2.1B — safe | ✅ |

**Verdict**: INTEGER is sufficient for all current use cases. No BIGINT needed.

### 10.3 VARCHAR vs UUID Primary Keys

| Table | PK Type | Verdict |
|-------|---------|---------|
| `subscription_plans` | `VARCHAR(255)` | ✅ Correct — natural keys ('free', 'premium') |
| `services` | `VARCHAR(255)` | ✅ Correct — natural keys ('track', 'form1', etc.) |
| `jobs` | `VARCHAR(255)` | ✅ Correct — prefixed UUIDs (`job_${uuid}`) |
| `ai_layout_mappings` | `VARCHAR(255)` | ✅ Hash-based key |
| All others | `UUID` | ✅ Correct — `gen_random_uuid()` |

**Verdict**: PK types are appropriate for each table.

---

## 11. The `RETURNING id` Pattern in db.js

### 11.1 How It Works

```javascript
async function run(sql, params = []) {
  let querySql = convertedSql;
  if (/^\s*insert\s+/i.test(querySql) && !/returning/i.test(querySql)) {
    querySql += ' RETURNING id';
  }
  const res = await p.query(querySql, params);
  const lastID = res.rows && res.rows[0] ? res.rows[0].id : null;
  return { lastID, changes: res.rowCount };
}
```

### 11.2 Per-Table Analysis

| Table | PK Type | `RETURNING id` returns | Correct? |
|-------|---------|------------------------|----------|
| All UUID PK tables | UUID | UUID | ✅ |
| `jobs` | VARCHAR(255) | Prefixed string e.g. `"job_550e8400-..."` | ✅ |
| `subscription_plans` | VARCHAR(255) | String e.g. `"free"` | ✅ |
| `services` | VARCHAR(255) | String e.g. `"track"` | ✅ |
| `ai_layout_mappings` | VARCHAR(255) | Hash string | ✅ |

### 11.3 Edge Case: INSERT ... ON CONFLICT

When `INSERT ... ON CONFLICT DO NOTHING` returns no row (because the row already existed and was not updated):
- `res.rows` is empty `[]`
- `res.rows[0]` is `undefined`
- `lastID` is `null`
- But `changes` (res.rowCount) for ON CONFLICT DO NOTHING returns 0, which is correct.

**This is handled correctly** — `{ lastID: null, changes: 0 }` is returned.

### 11.4 Edge Case: INSERT ... ON CONFLICT DO UPDATE

When `INSERT ... ON CONFLICT DO UPDATE` is used (e.g., `upsertOverride` in pricingRepository):
- The RETURNING id clause is NOT appended because the code already has `RETURNING *` in its own query (so the regex check `!/returning/i` skips the append). Wait — let me re-check...

Looking at `pricingRepository.upsertOverride()`:
```javascript
await run(`
  INSERT INTO service_price_overrides (...)
  VALUES (...)
  ON CONFLICT (scope_type, scope_id, service_id)
  DO UPDATE SET credit_cost = EXCLUDED.credit_cost, ...
`, [scopeType, scopeId, serviceId, creditCost, isActive, note]);
```
There's NO `RETURNING` clause in this SQL. The `run()` function appends `RETURNING id`. After the ON CONFLICT DO UPDATE, PostgreSQL returns the updated row with the `RETURNING id`. This works correctly — the updated row's UUID id is returned.

Then the code separately queries:
```javascript
const rows = await query('SELECT * FROM service_price_overrides WHERE scope_type = ? AND scope_id = ? AND service_id = ?', [...]);
```
This is redundant — the `RETURNING` result is discarded and a second query is executed unnecessarily.

### 11.5 Verdict

The `RETURNING id` pattern works correctly for all tables because every table has an `id` column as its primary key (either UUID or VARCHAR). The pattern is robust.

---

## 12. Additional Findings

### 12.1 `userSelect()` uses `SELECT *` with COALESCE

```javascript
function userSelect() {
  return `SELECT *, COALESCE(plan_id, 'free') AS subscription_plan FROM auth_users`;
}
```

`SELECT *` from auth_users returns 15+ columns. Several query methods use `userSelect()`, returning unnecessary data. For `getCredits()` (line 454), only `credits` is needed:
```sql
SELECT credits FROM auth_users WHERE id = ?
```
This is already correct — it doesn't use `userSelect()`.

### 12.2 `pricingRepository.ensureTable()` has a race condition

```javascript
async function ensureTable() {
  if (initialized) return;
  await query(`CREATE TABLE IF NOT EXISTS ...`);
  await query('CREATE INDEX IF NOT EXISTS ...');
  initialized = true;
}
```

The `initialized` flag is set AFTER the table creation, but there's no lock. Two concurrent calls could both pass the `if (initialized) return;` check, both attempt `CREATE TABLE IF NOT EXISTS` — one succeeds, the other might fail or succeed depending on timing. `CREATE TABLE IF NOT EXISTS` is idempotent, so this is safe but wasteful.

### 12.3 `serviceRepository.refreshCache()` called on every `getServiceRegistrySync()` when cache is expired

```javascript
function getServiceRegistrySync() {
  if (Date.now() > cacheExpiry) refreshCache().catch(() => {});
  return cacheMap;
}
```

This fires a background cache refresh on every call when expired, which means potentially multiple concurrent refreshes. In practice, the first call after expiry triggers a refresh, but subsequent near-simultaneous calls also trigger refreshes. This is racy but non-destructive (last writer wins on the cacheMap).

### 12.4 Pool connection leak in `runTransaction()` error path?

```javascript
async function runTransaction(fn) {
  const p = getDb();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
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
```

✅ **Correct** — `client.release()` is in the `finally` block, so the connection is always released, even on error.

### 12.5 No `ON CASCADE` on `credit_transactions.job_id`

The `credit_transactions.job_id` is `VARCHAR(255)` — it references `jobs.id` but there is NO foreign key constraint. If a job is deleted, credit_transactions records may reference non-existent jobs.

**Risk**: Low — the `job_id` is used for auditing, not for JOINs. Orphaned references are acceptable for audit logs.

---

## 13. Summary of Findings by Severity

### 🔴 CRITICAL (Must Fix)

1. **`INSERT OR IGNORE` / `INSERT OR REPLACE` conversion references non-existent columns** (db.js lines 79-81, 95-98)
   - `tracked_sarathi.app_no` → should be `tracked_applications.app_number`
   - `tracked_vahan.application_number` → should be `tracked_applications.app_number`
   - If any code in the codebase still calls these paths, the SQL will fail with "column does not exist".

### 🟠 HIGH (Should Fix)

2. **Correlated subquery N+1 in `getUsersWithSpentCredits()`** (authorizationRepository.js line 611)
   - Runs per user row, affecting bootstrap, users list, and stats endpoints.

3. **Missing index on `auth_verifications(canonical_phone, status, expires_at)`** — three query methods depend on this.

4. **`getJobStats()` — 7 separate COUNT queries** instead of 1-2 grouped queries.

5. **`getAllPlans()` N+1 — separate queries per plan** for service IDs when 1 batch query would work.

### 🟡 MEDIUM (Should Address)

6. **6 COUNT queries in rate limit usage endpoint** — can be combined into 1 GROUP BY query.

7. **Missing index on `authorized_groups(channel, is_active)`** — affects group listing.

8. **Missing FK index on `payment_requests(user_id)`** — affects JOIN in payment list queries.

9. **`?` in string literals would be replaced** by the regex in db.js line 54.

10. **No CHECK constraints on credit amounts, balances, or status columns** — defense-in-depth missing.

### 🟢 LOW (Nice to Have)

11. **`ai_layout_mappings` table is orphaned** — created in migration SQL but never in code.

12. **`addColumnIfMissing()` has TOCTOU race** — column existence check and ALTER are not atomic.

13. **No migration versioning system** — schema changes are tracked ad-hoc in code.

14. **`pricingRepository.ensureTable()` races with `initDb()`** — both try to create the same table.

15. **`serviceRepository.refreshCache()` can fire multiple concurrent refreshes** on cache expiry.

---

## 14. Recommendations

### Immediate (Critical/High)

1. **Fix the INSERT OR IGNORE conversion targets in db.js** — update column names to match the unified `tracked_applications` schema.

2. **Add index to `auth_verifications`**:
   ```sql
   CREATE INDEX CONCURRENTLY idx_auth_verifications_lookup
   ON auth_verifications(canonical_phone, status, expires_at DESC);
   ```

3. **Optimize `getUsersWithSpentCredits()`** — replace correlated subquery with a pre-aggregated CTE or lateral join.

4. **Optimize `getJobStats()`** — use `GROUP BY status` for counts, and `FILTER` for date-specific counts.

5. **Optimize `getAllPlans()`** — batch-load `plan_services` with a single query.

### Short-term (Medium)

6. **Add index to `authorized_groups(channel, is_active)`**.

7. **Add FK index to `payment_requests(user_id)`**.

8. **Consolidate rate limit COUNT queries** into single `GROUP BY` query in both `_loadCounts()` and admin router.

9. **Add CHECK constraints**:
   ```sql
   ALTER TABLE auth_users ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);
   ALTER TABLE credit_transactions ADD CONSTRAINT amount_non_negative CHECK (amount >= 0);
   ALTER TABLE credit_transactions ADD CONSTRAINT balance_after_non_negative CHECK (balance_after >= 0);
   ```

### Long-term (Low)

10. **Implement proper migration tracking** — add a `schema_migrations` table and a migration runner.

11. **Clean up orphaned `ai_layout_mappings` table** — either integrate into initDb or drop it.

12. **Make `retry` parameter for advisory lock configurable** instead of hardcoded retries.

---

**End of Audit Report** — 2026-06-06
