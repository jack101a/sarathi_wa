# Sarathi WA Bot

WhatsApp-first bot for Sarathi and Vahan workflows, with optional Telegram support, admin dashboard, background workers, scheduler jobs, PostgreSQL, Redis, and Docker deployment support.

The core business workflow from `test-scaling` is intentionally preserved in `src/`. The `scaling-production` branch adds production wrappers around that workflow so services can be deployed and scaled more safely.

## Current Architecture

```text
packages/api/              Admin API, health endpoints, frontend hosting
packages/common/           Shared config, DB, Redis, queues, repositories, services
packages/gateway-wa/       WhatsApp message gateway
packages/gateway-tg/       Telegram message gateway
packages/worker-api/       Non-browser/background job worker
packages/worker-browser/   Browser-heavy job worker
packages/scheduler/        Cron jobs for tracking, cleanup, billing, backups
src/                       Proven legacy business logic still used by workers/gateways
frontend/                  React admin dashboard
scripts/migrations/        SQL schema initialization/migrations
docs/                      Architecture and deployment notes
models/                    ONNX captcha/model files used by workers/API
```

Read more:

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment checklist](docs/DEPLOYMENT_CHECKLIST.md)

## Required Runtime Secrets

Do not hardcode these in code or Compose files:

- `PG_PASSWORD`
- `REDIS_PASSWORD`
- `ADMIN_TOKEN`
- `RAZORPAY_WEBHOOK_SECRET` if Razorpay webhooks are enabled
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` if Razorpay payments are enabled

## Local Setup

1. Copy `.env.example` to `.env`.
2. Copy `config.example.yml` to `data/config.yml` if it does not already exist.
3. Fill required values in `.env` and `data/config.yml`.
4. Install dependencies:

```bash
npm install
```

5. Start the API locally:

```bash
npm run start
```

## Docker Setup

Render and validate the main Compose file before starting containers:

```bash
ADMIN_TOKEN=your_admin_token \
PG_PASSWORD=your_postgres_password \
REDIS_PASSWORD=your_redis_password \
./scripts/compose.sh config
```

Start the stack:

```bash
ADMIN_TOKEN=your_admin_token \
PG_PASSWORD=your_postgres_password \
REDIS_PASSWORD=your_redis_password \
./scripts/compose.sh up -d --build
```

## Useful Commands

```bash
npm test
npm run test:status
npm run test:ack
npm run test:receipt
npm run test:vahan
npm run build:frontend
npm run docker:up
npm run docker:logs
npm run docker:down
```

## Health Endpoints

- `GET /livez`: process liveness.
- `GET /readyz`: PostgreSQL and Redis readiness.
- `GET /health`: backwards-compatible detailed health response.

## Production Notes

- PostgreSQL is the durable database.
- Redis is used for queues, short-lived sessions, pub/sub, idempotency, and throttling.
- WhatsApp auth data must be persisted through the configured volume/bind mount.
- `models/godmode_solver.onnx` must be present for Vahan captcha solving.
- Unknown `/admin/api/*` routes return JSON 404 responses.
- Request logs include `X-Request-Id` for production debugging.
