# Audit Control Plan

## Project Understanding

This is a WhatsApp/TG-driven Sarathi automation system with:

- WhatsApp/TG gateways for user messages and response delivery.
- Common package for command parsing, jobs, billing, auth, services, backups, queues.
- Browser worker for Sarathi portal automation.
- API/admin dashboard for users, plans, services, queues, backups, pricing, health, WA control.
- PostgreSQL + Redis + BullMQ.
- Multi-node setup using `INSTANCE_ID`, `INSTANCE_ROLE`, Redis/Postgres over WireGuard.
- Server A primary and Server B failover/worker-capable node.
- Portainer deployment and dashboard build committed in repo.

Current risk level: not launch-ready until audit passes, because this system has billing, automation, external portals, backup/restore, multi-node failover, and admin permissions.

## Critical Product Areas To Audit

1. User Message Intake
2. Service Catalog And Routing
3. Billing And Credits
4. Job Lifecycle
5. Browser Automation
6. Gateway Failover / Multi-Node
7. Admin Dashboard
8. API Security
9. Backup / Restore / Cloud Backup
10. Deployment
11. Frontend Build Integrity
12. Observability

## Specialist Agents To Run

Run these in this order. Each agent should inspect only and report. No coding yet.

### 1. Architecture And Launch Risk Agent

```text
You are auditing the sarathiwa_bot repo for launch readiness.

Scope:
- Read README.md, docs/, package.json, docker compose files, env examples.
- Understand architecture, deployment modes, packages, data flow.
- Identify launch blockers, unclear ownership, duplicate legacy code, missing docs, and architecture risks.

Do not modify files.
Do not modify files. Only inspect and write the report.

Report:
1. System map
2. Main workflows
3. Single-node vs multi-node behavior
4. Top launch blockers
5. Risky assumptions
6. Files inspected
7. Recommended next audits
```

### 2. WhatsApp Workflow And Parser Agent

```text
Audit user message handling and interactive flows.

Scope:
- packages/gateway-wa
- packages/common/src/commandNormalizer.js
- packages/common/src/interactiveFlowService.js
- packages/common/src/requestPipeline.js
- related tests

Check:
- command parsing
- numbered menu choices
- duplicate WhatsApp messages
- accidental service selection from application number/date
- wrong Form 1 auto-selection
- two-reply bugs
- failover gateway behavior
- user-facing messages

Do not modify files.
Do not modify files. Only inspect and write the report.

Report:
1. Confirmed workflows
2. Bugs found
3. Edge cases
4. Missing tests
5. Launch blockers
6. Exact reproduction examples
```

### 3. Billing And Job Lifecycle Agent

```text
Audit billing, credits, deduplication, and job lifecycle.

Scope:
- packages/common/src/requestPipeline.js
- packages/common/src/jobRepository.js
- authorizationRepository
- serviceRepository
- payment/plan/price related files
- worker job completion/failure paths

Check:
- reserve/release/deduct correctness
- duplicate job handling
- retry billing behavior
- failed job refund behavior
- non-retryable business errors
- group/user credit rules
- admin manual adjustments
- race conditions

Do not modify files.
Do not modify files. Only inspect and write the report.

Report:
1. Billing flow map
2. Job state map
3. Critical bugs
4. Race conditions
5. Missing tests
6. Launch blockers
```

### 4. Browser Automation Agent

```text
Audit Sarathi browser automation flows.

Scope:
- src/services/
- packages/worker-browser
- browser automation helpers
- captcha, OTP, dialog handling

Check:
- Apply DL flow
- LL/application services
- Track/print/form/receipt flows
- portal dialog handling
- retry logic
- timeout handling
- terminal business-rule errors
- screenshot/log capture
- whether user receives portal dialog text

Do not modify files.
Do not modify files. Only inspect and write the report.

Report:
1. Service-by-service automation map
2. Portal dialog risks
3. Retry risks
4. Timeout risks
5. User-message gaps
6. Launch blockers
```

### 5. Admin Dashboard And API Agent

```text
Audit admin dashboard and API behavior.

Scope:
- packages/api/src/routes/adminRouter.js
- frontend/src/app
- frontend build assumptions
- auth/session code
- settings/services/users/plans/jobs/queues/backup UI

Check:
- route auth coverage
- dangerous admin actions
- validation gaps
- UI calls matching API routes
- stale dist/build risk
- missing confirmation flows
- broken dashboard buttons/forms

Do not modify files.
Do not modify files. Only inspect and write the report.

Report:
1. Admin feature map
2. API route risk list
3. Frontend/API mismatch list
4. Security issues
5. Missing tests
6. Launch blockers
```

### 6. Backup Restore Cloud Agent

```text
Audit backup, restore, import, and rclone cloud backup.

Scope:
- packages/common/src/postgresBackup.js
- packages/common/src/cloudBackup.js
- admin backup routes
- frontend SettingsPanel backup UI
- backup docs/env examples

Check:
- PostgreSQL backup/restore correctness
- SQLite import safety
- schema reset risk
- rclone config handling
- secrets exposure
- rollback behavior
- destructive action safeguards
- scheduled cloud backup behavior

Do not modify files.
Do not modify files. Only inspect and write the report.

Report:
1. Backup flow map
2. Restore flow map
3. Data loss risks
4. Security risks
5. Missing tests
6. Launch blockers
```

### 7. Deployment And Multi-Node Agent

```text
Audit deployment readiness.

Scope:
- docker-compose.portainer.yml
- docker-compose.server-b.yml
- .env examples
- wireguard/
- docs deployment files
- package startup scripts

Check:
- Server A single-node behavior
- Server B failover behavior
- WireGuard dependency
- Postgres/Redis bind settings
- exposed ports
- volume persistence
- healthchecks
- Portainer redeploy process
- branch/update process

Do not modify files.
Do not modify files. Only inspect and write the report.

Report:
1. Required Server A env
2. Required Server B env
3. Single-node checklist
4. Multi-node checklist
5. Security risks
6. Launch blockers
```

### 8. Security And Permissions Agent

```text
Perform a security audit.

Scope:
- API auth
- admin routes
- webhook routes
- env/secrets
- file upload/restore/rclone config
- frontend exposure
- logs
- Docker compose exposure

Check:
- unauthenticated admin routes
- weak session handling
- secret leaks
- unsafe uploads
- command injection
- SSRF/path traversal
- dangerous exposed ports
- backup restore abuse

Do not modify files.
Do not modify files. Only inspect and write the report.

Report:
1. Critical vulnerabilities
2. High-risk misconfigurations
3. Medium/low issues
4. Exact files/routes
5. Exploit scenario where relevant
6. Launch blockers
```

## Correct Run Order

1. Architecture And Launch Risk Agent
2. WhatsApp Workflow And Parser Agent
3. Billing And Job Lifecycle Agent
4. Browser Automation Agent
5. Admin Dashboard And API Agent
6. Backup Restore Cloud Agent
7. Deployment And Multi-Node Agent
8. Security And Permissions Agent

## Required Report Format

Every agent report should use this format:

```text
Agent:
Scope inspected:
Files inspected:

Launch blockers:
- ...

High risk:
- ...

Medium risk:
- ...

Low risk:
- ...

Missing tests:
- ...

Questions:
- ...

Recommended fixes:
1.
2.
3.
```

## Initial Skeptical Findings

- There is both legacy `src/` code and package-based code. This can cause behavior drift.
- Service routing may have inconsistencies between service registry, authorization defaults, and fallback definitions.
- Billing needs deep audit because duplicate jobs, failed jobs, and retries can easily overcharge or undercharge.
- Browser automation needs strict terminal-error handling. Portal dialogs must become user-facing messages.
- Multi-node behavior depends on correct `INSTANCE_ID` and `INSTANCE_ROLE`, but also Redis/Postgres/WireGuard and gateway active ownership.
- Admin router is large and handles many dangerous actions. Auth and validation must be checked route by route.
- Backup/restore is high risk because it can destroy the database.
- Frontend `dist` is committed, so source/build mismatch is possible.
- Current tests are useful but not enough for launch; E2E workflow tests are needed.

## Backlog Process After Reports

Consolidate into:

1. P0 Launch Blockers
2. P1 Must Fix Before Public Launch
3. P2 Can Ship With Monitoring
4. P3 Later

Then assign each fix to the right specialist agent with exact implementation prompts.

## Final GO / NO-GO Checklist Draft

GO only if all are true:

- WhatsApp commands and numbered menus select the correct service.
- Duplicate messages do not create duplicate paid jobs or duplicate replies.
- Failed/non-retryable portal errors do not retry forever.
- Portal dialogs are sent back to the user safely.
- Billing reserve/deduct/release is correct under failure and duplicate cases.
- Server A single-node works without Server B.
- Server A/B multi-node works with only one active gateway responding.
- Backup restore succeeds on a test database.
- Rclone config can be set safely and does not leak secrets.
- Admin routes are authenticated and dangerous actions are protected.
- Portainer envs are correct for current deployment.
- Tests pass.
- One real end-to-end WhatsApp job succeeds in production-like setup.

NO-GO if any P0 remains open.
