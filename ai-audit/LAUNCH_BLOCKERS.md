# Launch Blockers

Current launch decision: **NO-GO**.

## P0-1: Heavy Billing Ledger Is Unsafe

Problem:
Heavy job credit reservation/finalization is not job-scoped or idempotent. Workers can mark jobs completed before billing finalization, and admin cancellation does not release reserved credits.

Required outcome:

- Each heavy job has a job-scoped reservation/ledger entry.
- Finalize/release is idempotent by `job_id`.
- Job completion and billing finalization are transactionally safe.
- Admin cancellation releases any reservation.

Owner agent:
Billing And Job Lifecycle Implementation Agent.

## P0-2: Runtime Admin Restore Is Unsafe

Problem:
Dashboard/API restore can drop schema while gateways/workers/scheduler/API writes continue. Rollback is not guaranteed.

Required outcome:

- Disable runtime restore for production, or enforce real maintenance mode across API writes, gateways, workers, and scheduler.
- Prefer shell/runbook restore until full maintenance mode is proven.
- Add restore rehearsal tests against temporary PostgreSQL.

Owner agent:
Backup Restore Cloud Implementation Agent.

## P0-3: WhatsApp Failover Ownership Is Unsafe

Problem:
`wa:active` has no TTL, heartbeat is role-based, and multiple primaries can block Server B promotion or leave no active responder.

Required outcome:

- Active gateway ownership uses a TTL lease.
- Heartbeat is keyed by `INSTANCE_ID`.
- Promotion/demotion is deterministic.
- Response delivery dedup does not lose messages when send fails.

Owner agent:
WhatsApp Workflow And Failover Implementation Agent.

## P0-4: Application Menu Can Misread Spaced DOB As Choices

Problem:
Input like `03 01 2008` during an active menu can select option `3` and run Form 1.

Required outcome:

- Date-like input is rejected as menu choices.
- Multi-select uses explicit delimiters only.
- Invalid choices produce a clear reply.
- `stop` clears active menu sessions.

Owner agent:
WhatsApp Workflow And Parser Implementation Agent.

## P0-5: Browser Automation Terminal Errors Are Not Reliable

Problem:
Portal dialogs and business errors are inconsistently classified. Some retry incorrectly, some are hidden from the user, and LL print OTP loop can hang indefinitely.

Required outcome:

- Shared portal error classifier.
- Terminal portal/user errors are non-retryable and user-visible.
- All retry loops have attempt and wall-clock limits.
- Failure diagnostics are captured consistently.

Owner agent:
Browser Automation Implementation Agent.

## P0-6: Deployment Network Exposure And Single-Node Ambiguity

Problem:
API is directly published, DB/Redis bind safety depends on env, Server A single-node can fail if bound to WireGuard IP without WireGuard, and `ajax_network` is undocumented.

Required outcome:

- Single-node and multi-node env/runbooks are separated.
- DB/Redis are bound only to localhost or WireGuard IP as appropriate.
- API direct exposure is intentionally controlled.
- `ajax_network` prerequisite is documented or removed.

Owner agent:
Deployment And Multi-Node Implementation Agent.

## P0-7: Secrets/Data Artifacts In Workspace

Problem:
Untracked real env/data artifacts exist and are not fully ignored.

Required outcome:

- Quarantine or remove local secret/data artifacts.
- Update ignore rules to cover `.env*`, trailing-space env names, local data/import/backup directories, SQLite files.
- Rotate any exposed secrets before production.

Owner agent:
Security And Permissions Implementation Agent.

