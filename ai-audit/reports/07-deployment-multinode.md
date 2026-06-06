Agent:
Codex

Scope inspected:
Server A Portainer stack, Server B worker/failover stack, env examples, WireGuard examples/scripts, deployment docs, package/Docker startup paths.

Server A required env: `TZ`, `NODE_ENV`, `APP_ENV`, `LOG_LEVEL`, `IMAGE_TAG`, `CONFIG_PATH`, `PORT`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PG_BIND`, `PG_HOST_PORT`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_BIND`, `REDIS_HOST_PORT`, `ADMIN_USERNAME`, one of `ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH`, `ADMIN_TOKEN`, `REQUIRE_CHAT_FRONTEND`, chat credentials/allowlists, queue/worker/browser settings, scheduler settings, Razorpay values if wallet/webhooks are enabled.

Server B required env: `TZ`, `NODE_ENV`, `APP_ENV`, `LOG_LEVEL`, `IMAGE_TAG`, `CONFIG_PATH`, `PGHOST=10.99.0.1`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `REDIS_HOST=10.99.0.1`, `REDIS_PORT`, `REDIS_PASSWORD`, matching `API_QUEUE_NAME`/`BROWSER_QUEUE_NAME`, WhatsApp credentials/allowlists, worker/browser settings, AI/Razorpay values if enabled.

Single-node checklist: create `ajax_network`, use safe DB/Redis binds, persist `/opt/sarathi/sarathi_new_test1/*`, set admin auth, pair both WA sessions or intentionally run one, verify `/livez`, `/readyz`, `/health`.

Multi-node checklist: WireGuard up before Server A binds `10.99.0.1`, open UDP `51820`, verify Server B can reach `10.99.0.1:5432/6379`, match DB/Redis passwords and queue names, pair `session-3`, test primary loss and queued response delivery.

Files inspected:
`docker-compose.portainer.yml`, `docker-compose.server-b.yml`, `.env.example`, `.env.docker.example`, `.env.portainer.example`, `.env.server-b.example`, `wireguard/server-a.conf.example`, `wireguard/server-b.conf.example`, `wireguard/setup-server-a.sh`, `wireguard/setup-server-b.sh`, `docs/DEPLOYMENT_CHECKLIST.md`, `docs/ARCHITECTURE.md`, `package.json`, package `package.json` files, service Dockerfiles, `scripts/compose.sh`, `scripts/ops/check-runtime-wiring.sh`, `nginx/nginx-server-b.conf`, gateway failover code.

Launch blockers:

- Server A Portainer stack requires external Docker network `ajax_network`; the stack will fail unless it already exists.
- `.env.portainer.example` binds Postgres/Redis to `10.99.0.1`; Server A single-node launch fails if WireGuard is not already up or the bind is not changed for single-node.
- Advertised failover is not reliable with two Server A primaries: both write the same `wa:heartbeat:primary`, while `wa:active` is instance-specific and never transferred if the active primary dies. Server B will not promote while any primary heartbeat remains.
- Server B failover requires `session-3` WhatsApp auth to be paired and persisted before failure. That prerequisite is not called out strongly enough.
- Deployment docs use `PG_PASSWORD`, but compose and code require `PGPASSWORD`.

High risk:

- Postgres/Redis exposure depends entirely on `PG_BIND`/`REDIS_BIND`; setting either to `0.0.0.0` would expose DB/Redis on host ports.
- WireGuard setup docs/scripts contradict the compose example by saying DB/Redis should bind to `0.0.0.0`; the safer production example binds to `10.99.0.1`.
- API publishes `${PORT}:3000` on all interfaces, with no TLS/reverse-proxy requirement in the inspected Portainer stack.
- Browser services run Chromium with `seccomp:unconfined`, no sandbox flags, and root images.
- Mutable `IMAGE_TAG=latest` is used in examples; rollback docs mention run-number tags, but redeploy/update docs do not enforce immutable tags.

Medium risk:

- Server B services have no healthchecks, so Portainer/Compose cannot report remote DB/Redis readiness directly.
- Server B has no local Postgres/Redis dependency gates; startup behavior depends on app-level retry/failure behavior.
- Portainer redeploy and branch/update process is underdocumented: no clear pull/recreate sequence, webhook flow, or image tag promotion process.
- Server B `/app/data` is local to Server B and not shared with Server A; DB/Redis are shared, but generated runtime files may diverge.
- Default `AUTO_CLOUD_BACKUP_ENABLED=true` needs rclone/provider setup or backup health can become noisy/failing.

Low risk:

- Compose config renders successfully with `.env.portainer.example` and `.env.server-b.example` under `docker-compose 1.29.2`.
- Postgres, Redis, and API have healthchecks on Server A.
- Persistent bind mounts exist for Postgres, Redis, WhatsApp auth data, app data, and rclone config on Server A.
- Runtime images have direct `CMD ["node", ...]` startup paths matching package scripts.

Missing tests:

- No automated test for Server A active primary death with another primary alive.
- No automated test for Server B promotion after primary heartbeat loss.
- No deployment smoke test for WireGuard DB/Redis reachability.
- No Portainer redeploy/update runbook validation.
- No security regression check for public DB/Redis/API port exposure.

Questions:

- Is Server A intended to run two active WhatsApp primary sessions, or should only one primary be enabled for production?
- Is `ajax_network` created by Portainer/another stack, and is it guaranteed before deploy?
- Should the public API port be fronted by an existing reverse proxy/TLS stack?
- Should production use immutable GHCR run tags instead of `latest`?

Recommended fixes:
1. Fix failover semantics: heartbeat per `INSTANCE_ID`, expire/transfer `wa:active`, and test active primary death plus Server B promotion.
2. Split single-node and multi-node env guidance: single-node bind DB/Redis to `127.0.0.1`; multi-node bind to WireGuard IP only after `wg0` is up.
3. Add a deployment runbook covering Portainer network creation, immutable image tags, pull/recreate steps, WireGuard verification, Server B session pairing, and branch/update rollback.
