# Final GO / NO-GO Checklist

Current result: **NO-GO**.

## GO Conditions

The project can move to GO only when all items below are true.

### Billing

- Heavy jobs reserve credits with job-scoped ledger entries.
- Finalize/release is idempotent by `job_id`.
- A completed heavy job cannot skip billing finalization.
- Admin cancellation releases reserved credits.
- Duplicate execution cannot double-charge or consume another job's reservation.

### WhatsApp And Workflows

- Spaced DOB input cannot trigger menu choices.
- Invalid menu choices produce a clear reply.
- `stop` clears active interactive flows.
- Duplicate WhatsApp messages do not create duplicate paid jobs or duplicate replies.
- WhatsApp failover recovers after active primary death.
- Response delivery cannot be lost because a send failed after dedup claim.

### Browser Automation

- Portal business dialogs are user-visible.
- Terminal portal/user errors are non-retryable.
- Captcha/OTP/download loops are bounded.
- Apply DL final submit dialogs are classified.
- DL renewal existing application/wrong OTP does not retry silently.
- LL print cannot hang a worker indefinitely.

### Backup And Restore

- Production dashboard restore is disabled or fully maintenance-gated.
- Gateways/workers/scheduler/API writes cannot race restore.
- Restore has been rehearsed on a temporary PostgreSQL database.
- Restore failure/rollback behavior is tested.
- Cloud backup destination and rclone config behavior are documented and tested.

### Deployment

- Server A single-node env works without WireGuard.
- Server A/B multi-node env works with WireGuard.
- DB/Redis are not exposed publicly.
- API direct exposure is intentional and protected.
- `ajax_network` prerequisite is documented or removed.
- `PGPASSWORD`/`PG_PASSWORD` naming is resolved.
- Immutable deploy tags or a clear rollback process exist.

### Security

- Local secret/data artifacts are quarantined or removed from repo workspace.
- `.gitignore` covers env/data/backup/SQLite artifacts.
- Any exposed secrets are rotated.
- Admin production login rejects placeholder secrets.
- Admin mutations have CSRF or equivalent protection.
- Admin routes have auth coverage tests.

### Verification

- Full test suite passes.
- New P0 regression tests pass.
- One real lightweight WhatsApp job succeeds.
- One real browser WhatsApp job succeeds.
- Backup creation succeeds.
- Restore rehearsal succeeds on non-production DB.
- Server B promotion/failover drill succeeds.

## NO-GO Conditions

Remain NO-GO if any are true:

- Heavy billing can be skipped, double-charged, or stuck.
- Runtime restore can race live writes.
- WhatsApp failover can leave no active responder.
- Menu choices can run the wrong paid service from a DOB/date input.
- Browser workers can hang indefinitely.
- Portal terminal errors retry silently or hide user-facing messages.
- DB/Redis/API are publicly exposed by accident.
- Real secrets/data artifacts remain in repo workspace without quarantine and rotation.

