# Master Findings

## Audit Status

All eight approved specialist audits are complete and saved under `ai-audit/reports/`.

Reports consolidated:

1. `01-architecture-launch-risk.md`
2. `02-whatsapp-workflow-parser.md`
3. `03-billing-job-lifecycle.md`
4. `04-browser-automation.md`
5. `05-admin-dashboard-api.md`
6. `06-backup-restore-cloud.md`
7. `07-deployment-multinode.md`
8. `08-security-permissions.md`

## Executive Summary

Current result: **NO-GO**.

The project is close, but the audit found true P0 launch blockers in five areas:

- Billing correctness for heavy jobs.
- Runtime database restore safety.
- WhatsApp failover ownership.
- Browser automation terminal-error handling.
- Deployment/security exposure and local secret hygiene.

The most important theme: several systems work in normal happy-path usage, but they are not yet safe under crash, duplicate delivery, restore, failover, malformed input, or stolen/misused admin session scenarios.

## True P0 Launch Blockers

### P0-1: Heavy Job Billing Is Not Job-Scoped Or Idempotent

Heavy jobs reserve aggregate user credits, then workers mark jobs completed before billing finalization. Reservations are stored only as `auth_users.reserved_credits`, not job-specific rows. Duplicate execution, crash after completion, admin cancellation, or overlapping jobs can leave credits stuck, not deducted, or deducted against the wrong reservation.

Reports: Billing, Architecture.

### P0-2: Live Admin Restore Can Destroy Or Race Production Data

The dashboard/API restore path drops `public` while only the API closes its DB pool and pauses BullMQ queues. Gateways, workers, scheduler, and other writes do not honor the maintenance flag. Rollback depends on a second destructive restore from a fresh safety dump.

Reports: Admin/API, Backup/Restore, Security.

### P0-3: WhatsApp Failover Can Get Stuck Or Double-Own Responses

`wa:active` has no TTL, heartbeat is role-based, and Server A runs multiple primaries. If active ownership becomes stale, no gateway may respond, or failover promotion may be blocked by another primary heartbeat. Response delivery also claims dedup before actual send.

Reports: Architecture, WhatsApp, Deployment.

### P0-4: Menu Choice Parsing Can Run Wrong Services From Spaced DOB

During an active application menu, input like `03 01 2008` can be parsed as numeric choices. Choice `3` maps to Form 1, which matches the observed random Form 1 problem.

Reports: WhatsApp.

### P0-5: Browser Automation Can Retry Or Hide Terminal Portal Errors

DL renewal terminal portal errors are plain `Error`s, Apply DL final dialogs are not classified, LL print OTP trigger loop is unbounded, and several services do not preserve portal dialog text for users.

Reports: Browser Automation.

### P0-6: Deployment Has Unsafe Or Ambiguous Network Binding

Server A single-node can fail if Postgres/Redis bind to `10.99.0.1` before WireGuard exists. API is directly published by Compose. DB/Redis host ports are controlled by env and can be accidentally exposed. `ajax_network` is required but not documented as a prerequisite.

Reports: Architecture, Deployment, Security.

### P0-7: Real Secret/Data Artifacts Exist In Workspace

Untracked `.env `, `.env.localtest`, `data/config.yml`, and `IMPORT BACKUP TEST/` contain or likely contain sensitive envs, SQLite DBs, backups, or runtime data. They are not all covered by `.gitignore`.

Reports: Security.

## P1 Must Fix Before Public Launch

- Admin mutation routes need CSRF or equivalent unsafe-method protection.
- Admin route validation is thin for plans, services, users, rate overrides, limits, and cloud config.
- User deactivation is effectively one-way from dashboard because inactive users disappear from normal lists.
- Admin cancellation must release reserved heavy-job credits.
- Telegram duplicate job handling lacks dedup keys.
- `commandNormalizer` multi-track regex can classify unrelated messages with two long numbers as `track_multiple`.
- Service registry has possible inconsistencies, including `resend_otp` queue classification.
- `PG_PASSWORD` docs conflict with actual `PGPASSWORD` env.
- Nginx/cert deployment path is unclear for local Docker.
- Rclone/cloud secrets are stored plaintext and can be included in DB backups.
- Runtime restore should either be disabled for production or require full enforced maintenance mode.
- Production should not accept placeholder `ADMIN_TOKEN` or weak admin fallback credentials.

## P2 Can Ship With Monitoring Or Operational Guardrails

- Frontend `dist` can become stale.
- Scheduler cron env examples do not match hardcoded schedules.
- Browser workers run root/sandbox-disabled.
- Public health endpoints expose dependency/memory details.
- Logs contain user identifiers and payment metadata.
- Cloud backup status can report misleading scheduled state or no-provider success/failure.
- Server B lacks healthchecks.
- Portainer redeploy and rollback runbook is incomplete.
- Backup downloads expose full DB to any admin.

## P3 Later

- Clean up legacy `src/` code or explicitly mark it as active/legacy.
- Add migration versioning and separate runtime seeding from schema ownership.
- Improve admin UX confirmations for non-restore dangerous actions.
- Add richer observability around response delivery and browser diagnostics.
- Decide whether WhatsApp self-registration should be public or invite-only.

## Conflicts Between Reports

- Restore docs conflict with UI behavior: shell script says stop app/worker/scheduler; dashboard/API presents restore as live operation.
- WireGuard docs/scripts mention `0.0.0.0` for DB/Redis exposure, while safer compose examples use `10.99.0.1`.
- README/deployment docs use `PG_PASSWORD`, while code/Compose use `PGPASSWORD`.
- Tests expect direct DL info parsing for `dl <number> <dob>`, while WhatsApp interactive flow may open a DL menu first.
- Runtime schema is split between SQL migration file and `authorizationRepository.initDb()`.

## Missing Audit Coverage

- No live E2E audit against actual Sarathi portal.
- No production host firewall audit.
- No actual restore rehearsal on a throwaway PostgreSQL database.
- No payment gateway live-mode audit.
- No WhatsApp session failover drill using real paired sessions.
- No legal/privacy review for handling user IDs, DOBs, licenses, and backups.

