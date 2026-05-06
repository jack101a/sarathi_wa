# Task Tracker: Scale Sarathi Bot to 50 Users

## Phase 1: Database Refactor & User Management
- [ ] Create `src/core/db.js` — central in-process SQLite connection
- [ ] Update `src/services/authzHelper.js` — add migration for new tables/columns
- [ ] Refactor `src/services/authorizationRepository.js` — use db.js instead of execSync
- [ ] Update `src/services/authorizationService.js` — async + user management functions
- [ ] Update `src/commands/authAdmin.js` — extended admin commands
- [ ] Update `src/core/auth.js` — make functions async
- [ ] Update callers in bot.js and telegramBot.js for async auth

## Phase 2: Rate Limiting
- [ ] Create `src/core/rateLimiter.js`
- [ ] Add rate limit config to `src/config/config.js`

## Phase 3: Job Queue System
- [ ] Create `src/core/jobQueue.js` — dual queue implementation
- [ ] Create `src/services/jobRepository.js` — job CRUD

## Phase 4: Worker System
- [ ] Create `src/workers/apiWorker.js`
- [ ] Create `src/workers/browserWorker.js`
- [ ] Create `src/workers/index.js` — worker bootstrap

## Phase 5: Request Pipeline Integration
- [ ] Create `src/core/requestPipeline.js`
- [ ] Refactor `src/bot.js` — thin routing through pipeline
- [ ] Refactor `src/telegramBot.js` — thin routing through pipeline
- [ ] Create `src/services/billingCron.js`
- [ ] Update `server.js` — start workers + billing cron
- [ ] Update `src/config/config.js` — queue config

## Verification
- [ ] Test DB migration
- [ ] Test user management commands
- [ ] Test job queue processing
- [ ] Test rate limiting
- [ ] Verify bot starts cleanly
