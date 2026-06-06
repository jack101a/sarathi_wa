Agent:
Codex

Scope inspected:
- Backup flow map: admin UI `Backup Now` -> `/admin/api/backup` -> `postgresBackup.createBackup()` -> `pg_dump -F c -b` -> `pg_restore --list` verify -> rotate local backups -> optional cloud upload. Scheduler runs same backup every 6 hours, then cloud upload.
- Restore flow map: admin UI restore/import -> `/backups/import` verifies uploaded `.dump` -> `/backups/:fileName/restore-safe` requires `RESTORE <file>` -> pauses BullMQ queues -> creates safety backup -> closes API DB pool -> `DROP SCHEMA public CASCADE` -> `pg_restore --single-transaction` -> attempts safety-backup rollback on failure.
- SQLite import checked via legacy `scripts/migrate-sqlite-to-pg.js`; production admin import only accepts PostgreSQL custom-format `.dump`.

Files inspected:
- `packages/common/src/postgresBackup.js`
- `packages/common/src/cloudBackup.js`
- `packages/common/src/cloudBackupSettings.js`
- `packages/api/src/routes/adminRouter.js`
- `frontend/src/app/components/SettingsPanel.jsx`
- `packages/scheduler/src/jobs/backup.js`
- `packages/scheduler/src/index.js`
- `packages/api/src/index.js`
- `scripts/migrate-sqlite-to-pg.js`
- `scripts/ops/restore-postgres.sh`
- `src/api/adminRouter.js`
- `src/core/dbBackup.js`
- `src/core/cloudBackup.js`
- `.env.example`
- `README.md`
- `docs/DEPLOYMENT_CHECKLIST.md`
- `docker-compose.yml`
- `docker-compose.portainer.yml`
- `packages/api/Dockerfile`
- `packages/scheduler/Dockerfile`
- `tests/testPostgresBackup.js`
- `tests/testRcloneConfig.js`

Launch blockers:

- Runtime admin restore is not safely isolated. It drops `public` while only the API process closes its own DB pool and pauses BullMQ queues; gateway, worker, scheduler, and other live processes are not stopped and do not honor `maintenance:database_restore`.
- Restore rollback is not a launch-grade guarantee. If restore fails after schema reset, rollback depends on a just-created safety dump and a second destructive schema reset; if that rollback fails, production can be left empty or partially unavailable.
- Destructive schema reset is exposed from the admin dashboard. The UI confirmation helps, but the code path still performs `DROP SCHEMA public CASCADE` from application runtime instead of a controlled maintenance shell.
- Backup/restore docs conflict with behavior: `scripts/ops/restore-postgres.sh` correctly says stop app/worker/scheduler containers, while the admin UI/API presents restore as a live dashboard operation.

High risk:

- Admin backup download exposes complete database dumps to any authenticated admin session. That includes user data, jobs, payment/audit records, provider configs, and stored cloud-backup secrets.
- Cloud provider secrets are stored plaintext in PostgreSQL JSONB. R2 secret is masked in API responses, and `rclone.conf` is not echoed back, but compromise of DB/local backup exposes them.
- SQLite migration script is not idempotent for all tables. Re-running can duplicate `auth_verifications` and `credit_transactions`, and it mutates existing users/plans/services via upsert without an explicit production safety backup.
- Admin restore does not block new HTTP requests, bot gateway writes, scheduler jobs, or repository reads during restore. Queue pause covers only BullMQ queues known to that API process.
- Imported dumps are verified only with `pg_restore --list`; there is no compatibility restore into a scratch database before allowing restore into production.

Medium risk:

- `restore-safe` has no dry-run endpoint, no restore plan preview, no target DB fingerprint, and no explicit "current DB backed up at <timestamp>" confirmation.
- `pg_dump` backup creation is correct for a consistent PostgreSQL snapshot, but backup health is local-file based only; it does not verify cloud availability or restoreability.
- Scheduled cloud backup logs "finished" even when no providers are enabled and `uploadToCloud()` returns `ok: false`.
- `nextScheduledAt` is inferred from latest backup time plus 6 hours, not from the actual cron schedule, so the dashboard can mislead after missed or skipped jobs.
- `rclone` remote/path are passed through as rclone destination arguments. Shell injection is avoided via `execFileSync`, but there is no allowlist or environment separation for what the pasted `rclone.conf` may access.
- Manual backup releases the DB operation lock before cloud upload, so a restore/import can start while cloud upload of the just-created file is still running.
- Legacy `src/api/adminRouter.js` still contains older backup/cloud routes with weaker restore safeguards. It appears not mounted by `packages/api`, but its presence is confusing operationally.

Low risk:

- `cloudBackup.checkRcloneInstalled()` in package code returns only boolean, while the UI tries to display a version string.
- `rclone.conf` status exposes filesystem path and mtime to admins; not a direct secret leak but unnecessary detail.
- Backup manifest is local and best-effort. Failed manifest writes do not fail backup creation.
- Rotation keeps recent/daily local dumps but does not coordinate with cloud retention or confirm cloud upload before deletion.
- `.env.example` mentions cloud backup setup but does not document restore safety, rclone mount requirements for both API and scheduler, or plaintext secret storage.

Missing tests:

- No integration test restoring into a real temporary PostgreSQL database.
- No failure-mode test for restore rollback after schema reset.
- No test proving gateway/worker/scheduler honor maintenance mode; currently they do not.
- No admin route tests for confirmation enforcement, locks, import size/type handling, and download authorization.
- No scheduled backup test covering cloud upload disabled/no-provider/failure behavior.
- No rclone upload/test coverage with config path shared between API and scheduler.
- No SQLite migration idempotency tests, duplicate transaction tests, or rollback tests.

Questions:

- Is dashboard restore intended for production, or should it be disabled and replaced by the maintenance shell restore flow?
- Are admins considered fully trusted to download DB dumps and write `rclone.conf`, or is a separate backup/restore permission needed?
- Should cloud-backup secrets be rotated after every restore/import from an older backup?
- Is the legacy `src/*` backup/cloud code still reachable in any deployment path?

Recommended fixes:
1. Disable admin runtime restore for launch, or gate it behind maintenance mode that stops/blocks API writes, gateways, workers, and scheduler; keep restore in `scripts/ops/restore-postgres.sh` until this is proven.
2. Add real PostgreSQL restore tests: scratch-DB restore, failed restore rollback, imported dump compatibility, and route-level destructive-action confirmation/lock tests.
3. Harden cloud backup: encrypt provider secrets or move them to env/secret storage, add rclone remote validation, document API+scheduler rclone mount requirements, and make scheduled cloud failures visible in health.
