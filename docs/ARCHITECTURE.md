# Sarathi WA Bot Architecture

This branch keeps the proven business workflow from `test-scaling` and wraps it with production services that can be deployed and scaled independently.

## Runtime Services

- `packages/api`: Express admin API, health endpoints, and compiled admin dashboard hosting.
- `packages/gateway-wa`: WhatsApp gateway. Receives chat messages and sends user-facing responses.
- `packages/gateway-tg`: Telegram gateway. Receives Telegram messages and sends notifications/responses.
- `packages/worker-api`: Fast/background API-style jobs that do not require a browser-heavy session.
- `packages/worker-browser`: Browser-heavy jobs that use Puppeteer/Playwright and external portals.
- `packages/scheduler`: Cron jobs for tracking refreshes, billing resets, cleanup, summaries, and backups.
- `packages/common`: Shared config, DB, Redis, queue, repository, authorization, rate-limit, payment, and request pipeline code.
- `src`: Legacy business logic that is still intentionally used by workers/gateways to preserve the working behavior from `test-scaling`.
- `frontend`: React admin dashboard.

## Request Flow

1. A user sends a WhatsApp or Telegram message.
2. The gateway normalizes the command and calls the shared request pipeline.
3. Lightweight commands can respond quickly.
4. Heavy commands create a database job and BullMQ queue job.
5. A worker processes the job and updates the job table.
6. The response is delivered back through Redis pub/sub to the correct gateway/chat.
7. Admin users manage users, plans, services, jobs, queues, payments, and tracking through `/admin` and `/admin/api`.

## Data Flow

- PostgreSQL is the main durable database.
- Redis is used for BullMQ, short-lived sessions, throttling, idempotency, and pub/sub responses.
- `data/config.yml` stores stable runtime settings.
- `.env` and deployment environment variables store secrets and deployment knobs.
- WhatsApp auth data is persisted through Docker volumes/bind mounts.

## API Standards

- Existing public/admin route paths are preserved.
- `/health` remains the backwards-compatible full health endpoint.
- `/livez` checks whether the API process is alive.
- `/readyz` checks whether the API can reach PostgreSQL and Redis.
- API requests receive an `X-Request-Id` response header for log correlation.
- Unknown `/admin/api/*` routes return JSON 404 instead of the frontend HTML shell.

## What Should Stay Stable

Do not casually rename these without a migration plan:

- Admin API routes under `/admin/api`.
- Bot commands and command aliases.
- Database table and column names.
- Queue names and job payload fields.
- Docker service names used by Compose networking.
- Environment variables used by deployed stacks.

## Safe Architecture Improvements Remaining

- Split `adminRouter.js` into route/controller/service files gradually, one domain at a time.
- Add focused request validation for admin write routes.
- Add more smoke tests for payment approval/rejection and tracking refresh.
- Add database migration version tracking.
- Add non-root Docker users where Puppeteer/WhatsApp volume permissions are confirmed.

## Risky Improvements To Postpone

- Moving all legacy `src` business logic into `packages/common` in one pass.
- Changing global API response shapes.
- Replacing Telegram libraries without end-to-end Telegram validation.
- Renaming env vars, Docker services, queue names, or database fields.
