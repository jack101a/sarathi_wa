Agent:
Codex security audit, read-only inspection.

Scope inspected:
API auth, admin routes, webhook route, env/secrets, backup import/restore, rclone/cloud backup config, frontend API exposure, logs, Docker Compose/nginx exposure, chat auth/self-registration.

Files inspected:
`packages/api/src/index.js`, `packages/api/src/middleware/adminAuth.js`, `packages/api/src/middleware/requestContext.js`, `packages/api/src/middleware/errorHandler.js`, `packages/api/src/routes/adminRouter.js`, `packages/common/src/postgresBackup.js`, `packages/common/src/cloudBackup.js`, `packages/common/src/cloudBackupSettings.js`, `packages/common/src/razorpayService.js`, `packages/common/src/config.js`, `packages/common/src/authorizationService.js`, `packages/common/src/logger.js`, `packages/gateway-wa/src/messageHandler.js`, `packages/gateway-wa/src/selfRegistrationService.js`, `packages/gateway-tg/src/messageHandler.js`, `src/api/adminAuth.js`, `src/api/adminRouter.js`, `src/core/cloudBackup.js`, `frontend/src/api/client.js`, `frontend/src/api/queries.js`, `frontend/src/app/components/SettingsPanel.jsx`, `docker-compose.yml`, `docker-compose.portainer.yml`, `docker-compose.server-b.yml`, `nginx/nginx.conf`, `nginx/nginx-server-b.conf`, `.env.example`, `.env.portainer.example`, `.env.docker.example`, `.gitignore`, `.env `, `.env.localtest`, `data/config.yml`, `IMPORT BACKUP TEST/data/config.yml`.

Launch blockers:

- Untracked real env/secret files exist and are not fully covered by `.gitignore`: `.env ` has a trailing space and `.env.localtest` does not match current ignore rules. They contain token/password/webhook/database variables. Exploit scenario: accidental commit or upload leaks bot tokens, DB/Redis credentials, Discord webhook, admin token.
- `IMPORT BACKUP TEST/` contains untracked SQLite databases and backup files with likely user/auth data. This is a launch blocker for packaging, image build context, handoff, or repo sharing.
- Docker Compose publishes the API directly with `ports: "${PORT}:3000"` in `docker-compose.yml:96-97` and `docker-compose.portainer.yml:258-259`, in addition to nginx. If `PORT=3000` or equivalent is exposed publicly, admin login and all admin API endpoints are internet-facing outside the intended TLS/proxy path.
- Postgres and Redis are host-published by env-controlled binds in `docker-compose.yml:38-39,54-55` and `docker-compose.portainer.yml:39-40,61-62`. Defaults are safe in local examples, but Portainer example binds them to WireGuard IP. Any mis-set `PG_BIND`/`REDIS_BIND` to `0.0.0.0` exposes DB/Redis directly.

High risk:

- Admin login accepts either `ADMIN_PASSWORD` or legacy `ADMIN_TOKEN` as the password value in `packages/api/src/middleware/adminAuth.js:43-52`. The examples still include `ADMIN_TOKEN=change_this_admin_token` in `.env.example:63-64`, `.env.portainer.example:40-41`, `.env.docker.example:38-39`. Weak/default token reuse would grant full admin control.
- Admin session cookies are Redis-backed and random, but there is no CSRF token on state-changing admin routes. Cookie settings are `httpOnly`, `sameSite: strict`, `secure` only when `APP_ENV=production` in `packages/api/src/middleware/adminAuth.js:68-74`. Risk is reduced by SameSite Strict, but not eliminated for same-site compromise or misconfigured non-production deployment exposed to users.
- Backup import/restore is extremely powerful. Authenticated admin can upload a 256 MB PostgreSQL custom dump and restore it after a text confirmation: `packages/api/src/routes/adminRouter.js:935-1008`. The restore path drops and recreates schema in `packages/common/src/postgresBackup.js:203-210,369-372`. Exploit scenario: stolen admin session uploads a malicious/old dump and replaces all users, plans, credits, jobs, and backup settings.
- rclone config can be replaced from the admin API at `packages/api/src/routes/adminRouter.js:1050-1058`; it writes to the container rclone config path in `packages/common/src/cloudBackup.js:62-79`. Exploit scenario: stolen admin session redirects backups to attacker-controlled storage or stores hostile rclone configuration.
- Razorpay webhook is intentionally unauthenticated at `packages/api/src/routes/adminRouter.js:157-242`. Signature verification is present, but `packages/common/src/razorpayService.js:91-99` skips verification outside production when `RAZORPAY_WEBHOOK_SECRET` is missing. Any staging/non-production instance with real DB/users could be abused to credit accounts.

Medium risk:

- Express does not set `trust proxy`, but login rate limiting keys on `req.ip` before `x-forwarded-for` in `packages/api/src/middleware/adminAuth.js:35-40`. Behind nginx/Docker this may rate-limit all users as one IP and may not correctly identify brute-force sources.
- No explicit Content-Security-Policy or HSTS headers were found. Current headers include request id, `nosniff`, `SAMEORIGIN`, and `no-referrer` in `packages/api/src/middleware/requestContext.js:10-13`; nginx TLS config lacks HSTS in `nginx/nginx.conf:38-50`.
- Public health endpoints expose dependency status and memory usage: `/health` in `packages/api/src/index.js:67-75`; `/livez` and `/readyz` are unauthenticated in `packages/api/src/index.js:51-65`. Low direct impact, but useful for reconnaissance.
- WhatsApp self-registration creates/activates free-plan users after OTP verification in `packages/gateway-wa/src/selfRegistrationService.js:192-215` and is reachable before normal authorization in `packages/gateway-wa/src/messageHandler.js:242-247`. This is not necessarily a bug, but it means the service is not closed-allowlist only.
- Logs include user identifiers and operational details: failed admin login username in `packages/api/src/middleware/adminAuth.js:58`, request paths in `packages/api/src/middleware/requestContext.js:17-30`, user/payment metadata in `packages/api/src/routes/adminRouter.js:190-230`, and phone/chat information in gateway logs. Logs should be treated as sensitive.
- Legacy `src/api/adminAuth.js` uses in-memory sessions and no `secure` cookie flag at `src/api/adminAuth.js:13-14,45-50`. It does not appear to be the current Docker/package API path, but keeping it creates deployment confusion.

Low risk:

- Backup import uses `path.basename`, generated filenames, `.dump` extension checks, max size, and `pg_restore --list` verification in `packages/common/src/postgresBackup.js:299-320`; path traversal and shell command injection were not found in the current package backup path.
- Process execution for `pg_dump`, `pg_restore`, `psql`, and `rclone` uses `execFile`/`execFileSync` with argument arrays, reducing shell injection risk: `packages/common/src/postgresBackup.js:214-228`, `packages/common/src/cloudBackup.js:107-115,202-205`.
- Admin routes after login/logout/webhook/verify are protected by `router.use(requireAdminAuth)` in `packages/api/src/routes/adminRouter.js:148-248`. I did not find unauthenticated admin data/mutation routes in the package API path.
- Frontend API client uses relative `/admin/api/...` URLs and cookie credentials; no frontend-embedded backend secrets were found in `frontend/src/api/client.js` or `frontend/src/api/queries.js`.

Missing tests:

- Auth coverage test proving every admin route except `/login`, `/logout`, `/verify`, and Razorpay webhook requires a valid session.
- Session security tests for cookie flags, Redis TTL expiry, logout invalidation, and brute-force throttling behind proxy headers.
- Backup import/restore abuse tests: invalid filenames, oversized uploads, malformed dumps, restore confirmation mismatch, concurrent restore lock, and rollback behavior.
- rclone config validation tests for dangerous/oversized configs and secret masking in provider responses.
- Docker/compose policy test or CI check preventing public `0.0.0.0` DB/Redis/API binds in production env.
- CSRF/security-header tests for admin state-changing routes and frontend delivery.

Questions:

- Is WhatsApp `/register` intended to allow public self-service onboarding, or should production be invite/admin-only?
- Should the API be reachable directly on `${PORT}`, or only through nginx/TLS?
- Are Server A DB/Redis ports intended to be WireGuard-only, and is there host firewall enforcement outside Compose?
- Is legacy `src/api/*` still deployable anywhere, or can it be treated as dead code?
- Are `.env `, `.env.localtest`, `data/`, and `IMPORT BACKUP TEST/` ever included in deployment artifacts or image build contexts?

Recommended fixes:
1. Remove/quarantine real env and backup artifacts from the repo workspace, rotate any secrets found there, and update `.gitignore` to cover `.env*`, trailing-space env names, local backup/import directories, SQLite files, and runtime data.
2. Bind API to localhost/private proxy only, remove direct public API publishing where nginx is used, and enforce firewall rules so Postgres/Redis are reachable only from Docker/private WireGuard peers.
3. Require `ADMIN_PASSWORD_HASH` in production, reject known placeholder secrets, retire legacy `ADMIN_TOKEN` login fallback, add CSRF tokens for admin mutations, enable `trust proxy` deliberately, and add CSP/HSTS headers.
