Agent:
Codex

Scope inspected:
Admin feature map: auth/login/session, bootstrap/dashboard stats, users/credits/logs/rate overrides, plans, services/pricing overrides, groups, tracked apps, jobs/queues/activity, health/config, PostgreSQL backup/import/download/restore, cloud backup providers/rclone/upload, disabled legacy payments, SSE dashboard updates.

Files inspected:
packages/api/src/routes/adminRouter.js; packages/api/src/middleware/adminAuth.js; packages/api/src/index.js; frontend/src/app/**; frontend/src/api/**; frontend/vite.config.js; frontend/package.json; frontend/dist/**; selected common repositories for validation behavior.

Launch blockers:

- Database restore is exposed from the live admin API, but the `maintenance:database_restore` Redis flag is not enforced anywhere else. Queues are paused, but API/gateway/user writes can still happen during restore and be lost or race with restored state.
- User deactivation is effectively one-way from the dashboard: user lists only return `WHERE u.is_active = 1`, so after clicking deactivate the user disappears and the UI's activate path cannot normally be reached.

High risk:

- No CSRF token or per-request confirmation header on cookie-authenticated admin mutations. `sameSite: strict` helps, but destructive POST/PATCH/PUT/DELETE routes still rely only on the session cookie.
- Dangerous admin actions include DB restore, backup import, cloud backup provider writes, rclone config writes, service disable/delete, plan delete, user credit mutation, user deactivate, and job cancel. Only restore has strong typed confirmation.
- Server-side validation is thin for plans, services, user profile updates, rate overrides, cloud backup config, and query limits. Some validation exists in pricing and backup name handling, but many routes pass `req.body` directly to repositories.
- OTPs are exposed in the users table and copied to clipboard from the dashboard. That may be intended for admin operations, but it is sensitive account activation material.

Medium risk:

- `/jobs` and `/activity` accept unbounded `limit` values; `/users/:phone/logs` and credit history cap limits, but these list endpoints do not.
- Service create/update lacks server validation for service id format, category, queue type, credit cost range, and sort order. The UI validates some fields, but direct API calls can bypass it.
- Plan create/update lacks server validation for id format, non-negative numeric limits, and valid service ids beyond whatever the DB/repository rejects.
- User rate overrides accept arbitrary JSON and numeric values, including negative or nonsensical limits.
- Login rate limiting keys on `req.ip` first and there is no `trust proxy` setup in the inspected API. Behind a proxy this can collapse all admins into one rate-limit bucket or make lockouts noisy.
- Cloud backup toggles and rclone config save have no confirmation flow despite changing external destinations and server config.
- `frontend/dist` is served whenever it exists. Current inspected dist appears fresh and contains the current admin routes, but deployment can serve stale UI if build output is not regenerated before release.

Low risk:

- `/payments` UI redirects to dashboard while legacy payment APIs return 410. This is consistent, but the disabled feature should be explicit in release notes.
- `QueuesPanel.jsx` exists but `/queues` redirects to `/jobs`; the queue UI is effectively embedded in Jobs, leaving dead/unused component surface.
- Logout is public before the auth middleware. It only clears the caller's cookie/session token, so impact is low.
- SSE `/admin/api/events` is protected by global auth and exists, but it has no heartbeat and keeps an in-memory client list per process.

Missing tests:

- Auth coverage tests proving every admin route except login/logout/Razorpay webhook requires a valid session.
- CSRF/unsafe method tests or explicit security tests for admin mutations.
- API validation tests for plans, services, users, credits, rate overrides, jobs/activity limits, cloud backup config, and backup import/restore.
- UI integration/e2e tests for login, users, credits, plans, services/pricing, jobs cancel, groups, settings backup/restore, and cloud backup forms.
- Build/deploy test that verifies `frontend/dist` is regenerated and matches current source before serving `/admin`.

Questions:

- Should inactive users be manageable/reactivatable from admin, or is deactivation intended to be permanent soft-delete?
- Is live DB restore intended for production, or should it require a maintenance mode that blocks all write paths?
- Are admins expected to view/copy activation OTPs, or should OTP display be removed or gated?

Recommended fixes:
1. Add enforced maintenance mode for restore: block all non-admin writes, stop gateways/workers or reject jobs, then restore; keep typed confirmation.
2. Add server-side schemas and caps for all admin mutation/list routes, plus CSRF protection for cookie-authenticated unsafe methods.
3. Add inactive-user listing/filtering/reactivation, confirmation flows for cloud/rclone/service disable/credit set, and e2e tests for critical dashboard actions.
