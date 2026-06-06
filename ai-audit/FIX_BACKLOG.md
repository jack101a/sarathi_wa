# Fix Backlog

## P0

1. Implement job-scoped credit reservations and idempotent billing finalization.
2. Make heavy job completion and billing finalization transactionally safe.
3. Release heavy-job reservations on admin cancellation.
4. Disable or fully gate runtime admin restore behind enforced maintenance mode.
5. Add restore rehearsal tests against a temporary PostgreSQL database.
6. Rework WhatsApp active ownership with TTL lease and per-instance heartbeat.
7. Fix menu choice parsing to reject date-like input and require explicit multi-select delimiters.
8. Add shared portal error classifier and non-retryable public portal errors across browser services.
9. Bound all browser captcha/OTP/download loops.
10. Split single-node and multi-node env/runbooks and secure DB/Redis/API binds.
11. Quarantine local secret/data artifacts and update ignore rules.

## P1

1. Add CSRF or equivalent unsafe-method protection for admin mutations.
2. Add server-side validation schemas for admin plans, services, users, rate overrides, config, and list limits.
3. Remove legacy `ADMIN_TOKEN` login fallback in production and require strong admin password/hash.
4. Add inactive-user listing/reactivation path.
5. Fix Telegram duplicate job handling with dedup keys.
6. Fix `commandNormalizer` multi-track regex and add negative tests.
7. Align docs/env naming from `PG_PASSWORD` to `PGPASSWORD` or explicitly support both.
8. Add queue-name consistency to Server A env path.
9. Resolve `resend_otp` service queue classification mismatch.
10. Add confirmation flows for cloud/rclone/service disable/credit changes.
11. Add tests for failover, billing, menu input, browser portal errors, admin auth coverage, and restore confirmation.

## P2

1. Add deployment runbook for Portainer pull/recreate, immutable tags, rollback, and WireGuard verification.
2. Add Server B healthchecks.
3. Add CSP/HSTS and deliberate `trust proxy` configuration.
4. Make cloud backup failures visible in health/status.
5. Add frontend build freshness check.
6. Improve browser failure screenshots/DOM capture across all services.
7. Add backup download permission separation or stronger admin role model.
8. Add scheduler cron env support or remove misleading env examples.

## P3

1. Remove or clearly isolate legacy `src/` code paths.
2. Add schema migration version table and separate schema from runtime seeding.
3. Improve admin dashboard UX around dangerous actions.
4. Add privacy/data retention docs for DOB/license/job artifacts.
5. Decide public self-registration policy.

