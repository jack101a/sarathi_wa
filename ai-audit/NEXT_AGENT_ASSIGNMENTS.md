# Next Agent Assignments

Do not run these until implementation is explicitly approved.

## 1. Billing And Job Lifecycle Implementation Agent

```text
You are fixing P0 billing correctness in sarathiwa_bot.

Scope:
- packages/common/src/authorizationRepository.js
- packages/common/src/jobRepository.js
- packages/common/src/requestPipeline.js
- packages/worker-api/src/processor.js
- packages/worker-browser/src/processor.js
- packages/api/src/routes/adminRouter.js
- tests related to billing/jobs

Implement:
1. Job-scoped heavy credit reservations with unique job_id.
2. Idempotent reserve/finalize/release.
3. Transactionally safe billing finalization and completed status.
4. Admin cancellation releases reservation.
5. Tests for success, failure, duplicate execution, admin cancel, and crash-order risk.

Do not touch unrelated code.
Return changed files and test output.
```

## 2. WhatsApp Workflow And Failover Implementation Agent

```text
Fix P0 WhatsApp failover and parser bugs.

Scope:
- packages/gateway-wa/src/heartbeat.js
- packages/gateway-wa/src/index.js
- packages/gateway-wa/src/responseDelivery.js
- packages/gateway-wa/src/messageHandler.js
- packages/common/src/interactiveFlowService.js
- packages/common/src/commandNormalizer.js
- tests

Implement:
1. TTL lease for wa:active.
2. Heartbeat keyed by INSTANCE_ID, not only role.
3. Deterministic primary/failover promotion behavior.
4. Response delivery claim behavior that does not lose message on send failure.
5. Reject date-like menu input such as `03 01 2008`.
6. Require explicit delimiters for multi-select.
7. Clear flow sessions on `stop`.
8. Add tests for stale active, primary death, spaced DOB, invalid choice, and multi-track regex negatives.

Return changed files and test output.
```

## 3. Browser Automation Implementation Agent

```text
Fix P0 browser automation terminal error handling.

Scope:
- packages/worker-browser/src/processor.js
- packages/common/src/userFacingErrors.js
- src/services/applyDlService.js
- src/services/dlRenewalService.js
- src/services/llPrintService.js
- src/services/llEditService.js
- src/services/paymentService.js
- src/services/slotBookingService.js
- src/services/mobileUpdateService.js
- shared service helpers/tests

Implement:
1. Shared portal-error helper/classifier.
2. Portal dialog text preserved as publicMessage for terminal errors.
3. retryable=false for user/portal business errors.
4. Bounded retries and wall-clock timeouts for captcha/OTP/download loops.
5. Apply DL final submit dialog capture.
6. DL renewal existing application/wrong OTP as non-retryable public errors.
7. LL print OTP loop max attempts.
8. Tests for worker safe messages and service-level terminal errors.

Return changed files and test output.
```

## 4. Backup Restore Cloud Implementation Agent

```text
Fix P0 backup/restore production safety.

Scope:
- packages/common/src/postgresBackup.js
- packages/common/src/cloudBackup.js
- packages/api/src/routes/adminRouter.js
- frontend/src/app/components/SettingsPanel.jsx
- scripts/ops/restore-postgres.sh
- docs
- tests

Implement:
1. Disable dashboard runtime restore in production or require full enforced maintenance mode.
2. Ensure gateways/workers/scheduler/API writes honor maintenance mode if runtime restore remains.
3. Add scratch PostgreSQL restore verification tests.
4. Add restore confirmation/lock tests.
5. Update UI/docs to prefer maintenance shell restore for production.
6. Make cloud backup failures visible in health/status.

Return changed files and test output.
```

## 5. Deployment And Security Implementation Agent

```text
Fix P0 deployment/security hygiene.

Scope:
- .gitignore
- docker-compose.yml
- docker-compose.portainer.yml
- docker-compose.server-b.yml
- .env examples
- docs/DEPLOYMENT_CHECKLIST.md
- wireguard/*
- packages/api/src/middleware/adminAuth.js
- packages/api/src/index.js
- nginx configs
- tests/scripts if applicable

Implement:
1. Ignore/quarantine local env/data/backup artifacts without committing secrets.
2. Split single-node and multi-node env guidance.
3. Document/create ajax_network prerequisite.
4. Ensure DB/Redis bind guidance is localhost for single-node and WireGuard-only for multi-node.
5. Reduce direct public API exposure or document/protect it.
6. Require strong admin password/hash in production and reject placeholders.
7. Add CSRF/security headers/trust proxy plan if feasible.

Return changed files and test output.
```

