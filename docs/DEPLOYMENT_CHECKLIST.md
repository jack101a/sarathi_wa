# Production Deployment Checklist

## Required Secrets

Set these in the deployment environment. Do not hardcode them in code or Compose files.

- `PG_PASSWORD`
- `REDIS_PASSWORD`
- `ADMIN_TOKEN`
- `RAZORPAY_WEBHOOK_SECRET` when Razorpay webhooks are enabled
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are required for wallet top-up
- `RAZORPAY_QR_NAME` is optional display text for generated Razorpay QR codes
- WhatsApp/Telegram authorization variables as needed

## Before Deploying

- Run `npm ci`.
- Run `npm test`.
- Run `npm run test:status`.
- Run `npm run test:ack`.
- Run `npm run test:receipt`.
- Run `npm run test:vahan`.
- Run `npm run build:frontend`.
- Run `./scripts/compose.sh config` with required env vars.
- Run `./scripts/ops/check-runtime-wiring.sh` after containers are up.
- Run `docker compose -f docker-compose.portainer.yml config` for Portainer deployments.
- Run `docker compose -f docker-compose.server-b.yml config` for Server-B deployments.
- Confirm `models/godmode_solver.onnx` exists in the image or mounted path.
- Confirm PostgreSQL and Redis are reachable only from intended hosts.

## After Deploying

- Check `GET /livez` returns HTTP 200.
- Check `GET /readyz` returns HTTP 200 with DB and Redis as `ok`.
- Check `GET /health` returns HTTP 200.
- Open `/admin` and log in.
- Send a lightweight bot command.
- Send a heavy queued bot command.
- Confirm the job appears in the admin dashboard.
- Confirm the response returns to the same chat.
- Test `stop` during an OTP/DOB pending session.
- Test Razorpay webhook with a signed payload before relying on auto-crediting.
- Confirm manual UPI/UTR wallet top-up is not exposed in the admin UI or bot help.

## Rollback

- Use the previous GHCR run-number image tag if a new image fails.
- Keep database migrations small and reviewed before running them.
- If a gateway fails, roll back that gateway image first; workers/API can often stay on the newer image if API contracts were not changed.
- If workers fail, pause new traffic and roll back worker images before changing gateway behavior.

## Password/Volume Troubleshooting

Changing `PG_PASSWORD` in Compose does not update an already-initialized PostgreSQL data volume. If logs show `password authentication failed for user "sarathi"`, either:

- set `PG_PASSWORD` back to the password that initialized the existing volume, or
- run `./scripts/ops/sync-postgres-password.sh`, then restart app containers, or
- create a fresh database volume only if you are intentionally discarding old database data.

Changing `REDIS_PASSWORD` requires the Redis container to be recreated with the current Compose command. If app logs say Redis has no password but a password was supplied, inspect the running Redis command and recreate the Redis container from the current Compose file.

Useful checks:

- `./scripts/ops/check-runtime-wiring.sh`
- `./scripts/compose.sh up -d --force-recreate redis api gateway-tg gateway-wa worker-api worker-browser scheduler`
