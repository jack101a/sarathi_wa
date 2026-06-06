Agent:
Codex launch-readiness audit, read-only. No files modified. Tests were not run.

Scope inspected:
System map: WhatsApp/Telegram gateways receive messages, normalize commands, call `packages/common` request pipeline, create PostgreSQL job rows, enqueue BullMQ jobs in Redis, workers execute legacy `src/` services, then publish chat responses back through Redis pub/sub. API serves `/admin`, `/admin/api`, health endpoints, backup/restore, users, plans, services, queues, payments, tracking. Scheduler runs cron jobs for billing, cleanup, tracking, summaries, and backups.

Main workflows: admin login/dashboard, bot auth/self-registration, lightweight status/form commands, browser-heavy OTP workflows, Razorpay webhook crediting, tracking refresh, backup/restore.

Single-node vs multi-node: local Compose runs Postgres, Redis, API, WA/TG gateways, API/browser workers, scheduler, nginx. Portainer runs Server-A with two WA gateways plus infra. Server-B runs additional worker/API/browser capacity and a failover WA gateway against Server-A Postgres/Redis over WireGuard.

Files inspected:
README.md, docs/ARCHITECTURE.md, docs/DEPLOYMENT_CHECKLIST.md, package.json, package-lock.json, frontend/package.json, package package.json files, all package Dockerfiles, docker-compose.yml, docker-compose.portainer.yml, docker-compose.server-b.yml, .env.example, .env.docker.example, .env.portainer.example, .env.server-b.example, config.example.yml, scripts/compose.sh, scripts/ops/check-runtime-wiring.sh, scripts/migrations/001_init.sql, nginx configs/cert README, key API/gateway/worker/scheduler/common source files.

Launch blockers:

- README and deployment checklist require `PG_PASSWORD`, but Compose, env examples, and code use `PGPASSWORD`. Following README Docker commands will not set the PostgreSQL password expected by Compose.
- `docker-compose.yml` always starts nginx with `/etc/nginx/certs/fullchain.pem` and `privkey.pem`; the repo intentionally has no certs. Default Docker launch can fail unless certs are provisioned first or nginx is disabled/adjusted.
- Admin cookie is `secure` whenever `APP_ENV=production`; direct `http://host:3000/admin` login will not persist in production. Docs tell users to open `/admin` but do not clearly require HTTPS/nginx.
- Multi-WA failover is unsafe: Portainer starts two `INSTANCE_ROLE=primary` gateways, `wa:active` has no TTL, and heartbeat is keyed only by role. If the active primary dies, another primary can remain inactive indefinitely; Server-B failover may also be masked by any surviving primary heartbeat.
- Portainer stack requires external Docker network `ajax_network`, but the deployment checklist does not document creating/validating it.
- Server-A compose files do not pass `API_QUEUE_NAME`/`BROWSER_QUEUE_NAME` into `x-app-env`, while Server-B does. Custom queue names can split producers and consumers across different queues.

High risk:

- Schema ownership is duplicated between `scripts/migrations/001_init.sql` and runtime `authorizationRepository.initDb()`. Runtime also seeds plans/services. There is no migration version table, so future schema drift is likely.
- Legacy `src/` remains actively imported by packages; ownership is unclear between `src/*` and `packages/common/*`, with duplicated wrappers and repositories.
- Scheduler env examples expose `AUTO_TRACK_CRON`/`VAHAN_TRACK_CRON`, but `packages/scheduler/src/index.js` uses hardcoded schedules.
- Backup/restore paths are powerful and exposed through admin API; launch docs mention checks but not an explicit restore rehearsal/runbook.
- Multi-node response delivery depends on Redis pub/sub and WA active-instance state; there is no documented operational procedure for promoting/demoting WA instances.

Medium risk:

- Docker docs say copy `config.example.yml` to `data/config.yml`, but Compose mounts `${CONFIG_PATH}/sarathi_new_test1/data:/app/data`; this is easy to misplace.
- Portainer Postgres does not mount `scripts/migrations`; it relies on runtime schema init. Local Compose uses SQL init plus runtime init.
- `.dockerignore` excludes `scripts/`, but local Compose mounts host migrations. Image-based deployments need runtime init to stay correct.
- Browser workers run as root with sandbox disabled. Docs note non-root as future work, but this is a launch hardening gap.
- Actual workspace has untracked `.env.localtest`, a file named `.env ` with trailing space, `IMPORT BACKUP TEST/`, and `ai-audit/`. These are hygiene risks for packaging/deploy handoff.
- `resend_otp` queue classification differs between fallback service cache and seeded DB behavior.

Low risk:

- `version: '3.8'` remains in local Compose; modern Docker Compose warns but still works.
- README has minimal local setup and does not explain admin user bootstrap, first WA pairing, or first production smoke test in detail.
- `frontend/dist` exists in workspace but is rebuilt in API Dockerfile; local `npm start` depends on already-built frontend for `/admin`.

Missing tests:

- Compose config test using README-provided env names.
- Fresh DB bootstrap test for local Compose and Portainer.
- Multi-WA active/failover behavior test, including active primary crash.
- Server-A/Server-B queue-name consistency test.
- Admin login test over both HTTP direct port and HTTPS proxy.
- Scheduler cron env override test.
- End-to-end queued command delivery through Redis pub/sub.
- Backup/restore rehearsal test against PostgreSQL production-like data.

Questions:

- Is production intended to use `PGPASSWORD` everywhere, or should docs/env be changed to `PG_PASSWORD`?
- Should two Portainer WA gateways both be primary, or should one be standby/failover?
- Is `/admin` expected to be accessed only through HTTPS nginx?
- Who owns future schema changes: SQL migrations, runtime `initDb()`, or both?
- Should custom queue names be supported, or should they be removed from env examples?
- Are `src/` legacy modules considered launch-stable, or is migration into `packages/common` still planned before launch?

Recommended fixes:
1. Align PostgreSQL env naming across README, checklist, examples, Compose, and code.
2. Fix WA active/failover locking with per-instance heartbeat and TTL-backed active ownership.
3. Make nginx/certs an explicit deployment mode or document cert provisioning before `docker compose up`.
4. Pass queue-name env vars consistently to all Server-A and Server-B services.
5. Establish one migration authority with version tracking and keep runtime seeding separate.
6. Add launch smoke tests for fresh deploy, admin login, one light command, one browser command, pub/sub response, backup, and multi-node failover.
