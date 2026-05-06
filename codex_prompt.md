# Codex Implementation Prompt — Scale Sarathi Bot to 50 Users

## Project
Node.js WhatsApp/Telegram bot at `c:\codex\Antigravity\sarathi_wabot_lastest`.  
Stack: `whatsapp-web.js`, `node-telegram-bot-api`, `sqlite3`, `playwright`, `puppeteer`, `axios`, `node-cron`.  
No new npm packages unless absolutely necessary. Use only what is already in `package.json`.

## Goal
Scale the bot to 50 users by adding user management, subscription enforcement, rate limiting, a dual job queue, and a worker system. Do NOT break any existing functionality.

---

## PHASE 1 — Database Refactor & User Management

### Task 1.1 — Create `src/core/db.js`
Central in-process async SQLite wrapper. Use the existing `sqlite3` package.
- Open database at path from `process.env.AUTHZ_DB_PATH` or `data/authz.sqlite`
- Enable WAL mode: `PRAGMA journal_mode=WAL`
- Export three functions:
  - `async query(sql, params=[])` → returns array of rows
  - `async run(sql, params=[])` → returns `{ lastID, changes }`
  - `async close()` → closes the DB
- Use a module-level singleton connection (open once, reuse)

### Task 1.2 — Update `src/services/authzHelper.js`
Keep the existing CLI interface (`init`, `query`, `run` argv commands) for backward compat.  
In the `init` command, after the existing `CREATE TABLE IF NOT EXISTS` statements, add these migrations using `db.run` wrapped in try/catch (ALTER TABLE fails silently if column exists):

New columns on `auth_users`:
```sql
ALTER TABLE auth_users ADD COLUMN name TEXT DEFAULT '';
ALTER TABLE auth_users ADD COLUMN subscription_plan TEXT DEFAULT 'free';
ALTER TABLE auth_users ADD COLUMN monthly_limit INTEGER DEFAULT 50;
ALTER TABLE auth_users ADD COLUMN used_count INTEGER DEFAULT 0;
ALTER TABLE auth_users ADD COLUMN daily_count INTEGER DEFAULT 0;
ALTER TABLE auth_users ADD COLUMN expiry_date TEXT DEFAULT '';
ALTER TABLE auth_users ADD COLUMN billing_cycle_start TEXT DEFAULT '';
ALTER TABLE auth_users ADD COLUMN last_daily_reset TEXT DEFAULT '';
```

New tables:
```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_phone TEXT NOT NULL,
  queue_type TEXT NOT NULL,
  command TEXT NOT NULL,
  payload_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  result_json TEXT DEFAULT '{}',
  error_text TEXT DEFAULT '',
  chat_id TEXT NOT NULL,
  transport TEXT DEFAULT 'whatsapp',
  priority INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT DEFAULT '',
  completed_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(queue_type, status);

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  command TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_log_user ON rate_limit_log(user_id, timestamp);
```

### Task 1.3 — Refactor `src/services/authorizationRepository.js`
Replace ALL `execSync` child-process calls with `db.js`.  
- Import `{ query, run }` from `../core/db`
- Make `querySync` → `async query(sql, params)` 
- Make `runSync` → `async run(sql, params)`
- Update `initDb()` to call `node authzHelper.js init` once for migrations, then use in-process db for all other ops
- Add these new exported async functions:
  - `getUserById(id)` → SELECT by id
  - `listAllUsers()` → SELECT all active users with all fields
  - `updateUserProfile(phone, { name, subscription_plan, monthly_limit, expiry_date })` → UPDATE auth_users
  - `incrementUsage(userId)` → UPDATE used_count = used_count+1, daily_count = daily_count+1
  - `resetMonthlyUsage(userId)` → UPDATE used_count=0, billing_cycle_start=now
  - `resetDailyCount(userId)` → UPDATE daily_count=0, last_daily_reset=now
  - `deactivateUserById(id)` → UPDATE is_active=0 by id
- Update all existing functions (`getUserByPhone`, `createUser`, etc.) to be async

### Task 1.4 — Update `src/services/authorizationService.js`
- All functions become async
- Update `isAuthorizedWhatsApp`, `isAuthorizedTelegram`, `isAdminWhatsApp`, `isAdminTelegram` to `await` repo calls
- Add `getUserForRequest(message, transport)`:
  - Extracts phone from message
  - Returns the full user record from DB or null
- Add `isUserAllowed(user)`:
  - Returns `{ allowed: bool, reason: string }`
  - Checks: `is_active`, `expiry_date` (if set, compare to today), subscription validity
- Update `addAuthorizedEntry(channel, type, id, extras={})`:
  - Accept `extras = { name, plan, monthly_limit, expiry_date }` and save them
- Add `editUser(phone, updates)` → calls `updateUserProfile`
- Add `deleteUser(phone)` → calls `deactivateUser`
- Add `listUsers()` → calls `listAllUsers`
- Add `getUserDetails(phone)` → returns full user record

### Task 1.5 — Update `src/core/auth.js`
Make `isAuthorized`, `isAdminUser`, `isTgAuthorized` async and await the service calls.

### Task 1.6 — Update `src/commands/authAdmin.js`
Add new admin command handlers (all returned as text strings):
```
auth add user <phone> [name] [plan] [monthly_limit] [expiry_YYYY-MM-DD]
auth edit user <phone> [name=X] [plan=X] [limit=N] [expiry=YYYY-MM-DD] [status=active|inactive]
auth delete user <phone>
auth list users
auth user <phone>          → show name, plan, used/limit, expiry, status
auth reset usage <phone>   → reset monthly used_count to 0
```
Keep existing commands working: `auth add user`, `auth remove user`, `auth add group`, etc.

---

## PHASE 2 — Rate Limiting

### Task 2.1 — Create `src/core/rateLimiter.js`
```js
// In-memory sliding window rate limiter
// Uses rate_limit_log table for per-minute/day checks
// Exports:
async function checkRateLimit(userId, plan) 
  // Returns { allowed: bool, reason: string }
  // Checks per-minute (last 60s), per-day (last 24h), monthly used_count vs monthly_limit

async function recordRequest(userId, command)
  // INSERT into rate_limit_log, then DELETE old entries > 24h

async function getActiveJobCount(userId)
  // SELECT count from jobs WHERE user_id=? AND status IN ('pending','running')

// Plan limits (read from CONFIG.RATE_LIMITS):
// free:    { perMinute: 5,  perDay: 100, maxConcurrent: 2 }
// premium: { perMinute: 15, perDay: 300, maxConcurrent: 5 }
```

### Task 2.2 — Update `src/config/config.js`
Add to the CONFIG object:
```js
RATE_LIMITS: {
  free:    { perMinute: 5,  perDay: 100, perMonth: 50,  maxConcurrent: 2 },
  premium: { perMinute: 15, perDay: 300, perMonth: 500, maxConcurrent: 5 },
},
QUEUE: {
  API_CONCURRENCY: asNumber(process.env.API_CONCURRENCY, 5),
  BROWSER_CONCURRENCY: asNumber(process.env.BROWSER_CONCURRENCY, 1),
  BROWSER_DELAY_MS: asNumber(process.env.BROWSER_DELAY_MS, 3000),
  BROWSER_MAX_RETRIES: asNumber(process.env.BROWSER_MAX_RETRIES, 2),
  BROWSER_BACKOFF_MS: asNumber(process.env.BROWSER_BACKOFF_MS, 5000),
},
```

---

## PHASE 3 — Job Queue System

### Task 3.1 — Create `src/services/jobRepository.js`
Use `src/core/db.js`. Export async functions:
- `createJob({ id, userId, userPhone, queueType, command, payloadJson, chatId, transport })` → INSERT
- `updateJobStatus(jobId, status, resultJson='{}', errorText='')` → UPDATE + set started_at or completed_at
- `getJobById(jobId)` → SELECT
- `getActiveJobsForUser(userId)` → SELECT WHERE status IN ('pending','running')
- `getPendingJobs(queueType, limit=10)` → SELECT oldest pending jobs for a queue
- `cleanupOldJobs(days=30)` → DELETE completed/failed jobs older than N days

### Task 3.2 — Create `src/core/jobQueue.js`
Lightweight in-memory queue backed by SQLite job status. No Redis needed.

```js
class JobQueue {
  constructor(name, concurrency, options = {})
  // options: { delayMs, maxRetries, backoffMs }

  // Register the async handler function for processing jobs
  process(handlerFn)

  // Add a job object to the queue (already saved to DB by caller)
  enqueue(job)

  // Get queue stats
  getStats() // { pending, running, completed, failed }
}

// Export two singleton instances:
const apiQueue = new JobQueue('api', CONFIG.QUEUE.API_CONCURRENCY);
const browserQueue = new JobQueue('browser', CONFIG.QUEUE.BROWSER_CONCURRENCY, {
  delayMs: CONFIG.QUEUE.BROWSER_DELAY_MS,
  maxRetries: CONFIG.QUEUE.BROWSER_MAX_RETRIES,
  backoffMs: CONFIG.QUEUE.BROWSER_BACKOFF_MS,
});

module.exports = { apiQueue, browserQueue };
```

Implementation notes:
- Maintain an in-memory `Set` of running job IDs
- On `enqueue`, push to internal array, then `_tick()`
- `_tick()` pulls from array while `running.size < concurrency`, calls handler
- On handler complete: update DB status to `completed` or `failed`, remove from running, call `_tick()` again
- For `browserQueue` with `delayMs > 0`: await a sleep before starting each job

---

## PHASE 4 — Workers

### Task 4.1 — Create `src/workers/apiWorker.js`
Register handler on `apiQueue`. The handler receives a `job` object with `{ command, payloadJson, chatId, transport, userPhone }`.

Parse `payload = JSON.parse(job.payload_json)`.

Handle these commands by calling existing services (import them at top of file):
- `track` → `statusService.getStatusSnapshot(payload.appNo)` → send image via chatNotifier
- `form1|form1a|form2` → `formService.downloadForm(payload.appNo, payload.dob, command)` → send PDF
- `formset` → `formsetService.downloadFormSet(payload.appNo, payload.dob)` → send PDF
- `appl_image` → `ackService.getAckImage(payload.appNo, payload.dob)` → send image
- `appl_pdf` → `ackService.getAckPDF(payload.appNo, payload.dob)` → send PDF
- `track_rc` → `vahanService.startLookup(client, payload.chatId, payload.appNo, transport, opts)`
- `add_track` → call tracking add logic
- `remove_track` → call tracking remove logic
- `list_track` → call tracking list logic
- `refresh_track` → call refresh logic
- `track_status` → `imageGeneratorService.generateStatusImage(payload.chatId)` → send image

Use `chatNotifier` to send results back to user.
After sending, update job status to `completed` or `failed`.

### Task 4.2 — Create `src/workers/browserWorker.js`
Register handler on `browserQueue`.

Handle:
- `llprint_start` → `llPrintService.startLLPrintFlow(payload.appNo, payload.dob, payload.mobile)` → context/page stored in memory Map keyed by chatId, reply "OTP sent, enter it now"

Note: OTP submission remains inline in bot.js (interactive, not queued).

### Task 4.3 — Create `src/workers/index.js`
Import both workers (side-effect: registers handlers).  
Export `startWorkers()` and `stopWorkers()`.

---

## PHASE 5 — Request Pipeline Integration

### Task 5.1 — Create `src/core/requestPipeline.js`

```js
async function processRequest(message, transport, commandInfo) {
  // commandInfo = { command, payload, chatId }
  
  // 1. Identify user
  const user = await authService.getUserForRequest(message, transport);
  if (!user) return reply(message, '❌ You are not registered. Contact admin.');

  // 2. Check subscription/status
  const allowed = authService.isUserAllowed(user);
  if (!allowed.allowed) {
    if (allowed.reason === 'expired') return reply(message, '⏰ Your subscription has expired. Contact admin.');
    if (allowed.reason === 'inactive') return reply(message, '🚫 Your account is inactive. Contact admin.');
    return reply(message, '🚫 Access denied.');
  }

  // 3. Rate limits
  const rateCheck = await rateLimiter.checkRateLimit(user.id, user.subscription_plan || 'free');
  if (!rateCheck.allowed) {
    return reply(message, `⏳ Rate limit reached: ${rateCheck.reason}. Please wait.`);
  }

  // 4. Concurrent job limit
  const activeCount = await rateLimiter.getActiveJobCount(user.id);
  const limits = CONFIG.RATE_LIMITS[user.subscription_plan || 'free'];
  if (activeCount >= limits.maxConcurrent) {
    return reply(message, '⏳ You already have jobs running. Please wait for them to finish.');
  }

  // 5. Pick queue
  const queueType = getQueueType(commandInfo.command); // 'api' or 'browser'
  
  // 6. Create job in DB
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  await jobRepository.createJob({
    id: jobId, userId: user.id, userPhone: user.canonical_phone,
    queueType, command: commandInfo.command,
    payloadJson: JSON.stringify(commandInfo.payload || {}),
    chatId: commandInfo.chatId, transport,
  });

  // 7. Increment usage
  await authRepo.incrementUsage(user.id);
  await rateLimiter.recordRequest(user.id, commandInfo.command);

  // 8. Enqueue
  const job = { id: jobId, command: commandInfo.command, payload_json: JSON.stringify(commandInfo.payload || {}), chat_id: commandInfo.chatId, transport, user_phone: user.canonical_phone };
  if (queueType === 'browser') browserQueue.enqueue(job);
  else apiQueue.enqueue(job);

  return { blocked: false, jobId };
}

function getQueueType(command) {
  const browserCommands = ['appl_pdf', 'appl_image', 'llprint_start'];
  return browserCommands.includes(command) ? 'browser' : 'api';
}
```

### Task 5.2 — Refactor `src/bot.js`
Replace the body of `handleMessage()` with thin routing:

1. Keep these commands **inline** (no queue): `alive`, `suno`, `help`, `send_chatid`, `auth` (admin), OTP submission for llprint, media receipt extraction
2. For all other commands, extract the command+payload, call `requestPipeline.processRequest()`, send a brief "⏳ Processing..." acknowledgment message
3. Map command text to `commandInfo`:

```js
// track <appNo> [dob]  → { command: 'track', payload: { appNo, dob } }
// appl <appNo> <dob>   → { command: 'appl_image', payload: { appNo, dob } }
// form1 <appNo> <dob>  → { command: 'form1', payload: { appNo, dob } }
// llprint <appNo> <dob> → { command: 'llprint_start', payload: { appNo, dob, mobile } }
// track rc <appNo>     → { command: 'track_rc', payload: { appNo } }
// add track rc ...     → { command: 'add_track_rc', payload: { appNo, tag } }
// track status         → { command: 'track_status', payload: {} }
// list track           → { command: 'list_track', payload: {} }
// refresh track        → { command: 'refresh_track', payload: {} }
// add track ...        → { command: 'add_track', payload: { appNo, dob, tag } }
// remove track ...     → { command: 'remove_track', payload: { appNo } }
```

### Task 5.3 — Create `src/services/billingCron.js`
Using `node-cron`:
```js
// Daily at midnight: reset daily_count for all users
cron.schedule('0 0 * * *', resetAllDailyCountsJob);

// Every hour: check users whose billing_cycle_start + 30 days <= now, reset used_count
cron.schedule('0 * * * *', resetExpiredMonthlyCountsJob);

// Weekly: clean up old jobs
cron.schedule('0 2 * * 0', () => jobRepository.cleanupOldJobs(30));

function startBillingCron() { /* start the schedules */ }
module.exports = { startBillingCron };
```

### Task 5.4 — Update `server.js`
```js
const { startWorkers, stopWorkers } = require('./src/workers');
const { startBillingCron } = require('./src/services/billingCron');

// In startServer(): after starting bots, call:
startWorkers();
startBillingCron();

// In handleShutdown(): add:
await shutdownService('Workers', stopWorkers);
```

---

## CONSTRAINTS & RULES

1. **Do NOT remove or rename any existing exported functions** — other files depend on them
2. **Do NOT change the CLI interface of authzHelper.js** — it must still work as `node authzHelper.js init|query|run`
3. **All new async functions must handle errors internally** and never crash the main process
4. **The interactive llprint OTP flow** stays inline in bot.js — only the `startLLPrintFlow` call moves to browserQueue
5. **Existing scheduled jobs** (`autoTrackService`, `dailyNotificationService`, `vahanService`) remain unchanged
6. **chatNotifier** is already set up to send to both WhatsApp and Telegram — workers must use it to deliver results
7. **No Redis, no Bull, no external queue libraries** — use only `sqlite3` + in-memory arrays
8. Use `// @ts-nocheck` at top of files if TypeScript inference would complain

## IMPLEMENTATION ORDER

Follow this exact order:
1. `src/core/db.js`
2. `src/services/authzHelper.js` (add migrations)
3. `src/services/authorizationRepository.js` (async refactor)
4. `src/services/jobRepository.js`
5. `src/config/config.js` (add RATE_LIMITS + QUEUE)
6. `src/services/authorizationService.js` (async + new functions)
7. `src/core/auth.js` (async)
8. `src/commands/authAdmin.js` (new commands)
9. `src/core/rateLimiter.js`
10. `src/core/jobQueue.js`
11. `src/workers/apiWorker.js`
12. `src/workers/browserWorker.js`
13. `src/workers/index.js`
14. `src/core/requestPipeline.js`
15. `src/bot.js` (refactor handleMessage)
16. `src/telegramBot.js` (same refactor)
17. `src/services/billingCron.js`
18. `server.js` (wire up workers + billing)

After ALL files are written, run:
```
node -e "require('./src/core/db').query('SELECT name FROM sqlite_master WHERE type=\"table\"').then(r => { console.log('Tables:', r.map(x=>x.name)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
```
to verify the DB is healthy.
