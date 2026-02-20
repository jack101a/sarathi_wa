# Sarathi WA Bot

Cross-platform WhatsApp bot for Sarathi status and acknowledgement workflows, configured fully through environment variables.

## Project structure

```text
src/
  commands/
  config/
  core/
  services/
tests/
Dockerfile
.dockerignore
.env
.env.example
server.js
```

## Environment setup

1. Copy `.env.example` to `.env`.
2. Fill in required values:
   - `HOME_URL`
   - `STATUS_URL`
   - `FORM_URL`
   - `ACK_URL`
   - `STATE_ID`
   - `STATE_CODE`
3. Install dependencies:

```bash
npm install
```

4. Start the bot:

```bash
npm run start
```

First run will print a WhatsApp QR in terminal. After login, `LocalAuth` persists session data in `.wwebjs_auth/` so QR scan is not required on every restart.

The app validates required env vars on startup and exits with a friendly message if any required variable is missing.

## Environment variable reference

- `APP_ENV`: `development` or `production`.
- `DEBUG`: Enable debug logs (`true`/`false`).
- `PORT`: App port value (for container/platform compatibility).
- `SESSION_NAME`: LocalAuth client id used for persistent WhatsApp session storage.
- `USER_AGENT`: Shared outbound user agent.
- `TIMEOUT_MS`: HTTP and Puppeteer timeout in milliseconds.
- `HOME_URL`: Sarathi home URL.
- `STATUS_URL`: Status endpoint.
- `FORM_URL`: Form endpoint.
- `ACK_URL`: Acknowledgement endpoint.
- `STATE_ID`: State identifier for portal flow.
- `STATE_CODE`: State code (example: `MH`).
- `SESSION_MAX_REQUESTS`: Max requests before cookie/session rotation.
- `SESSION_TTL_MS`: Session cache TTL in ms.
- `PUPPETEER_HEADLESS`: Run Puppeteer in headless mode.
- `PUPPETEER_DISABLE_SANDBOX`: Add no-sandbox flags when needed.
- `PUPPETEER_EXECUTABLE_PATH`: Chrome path override (important in Docker).
- `PUPPETEER_ARGS`: Optional comma-separated Chromium flags.
- `TEST_APP_NO`: Optional app number for local tests.
- `TEST_DOB`: Optional DOB for local tests.
- `DISCORD_WEBHOOK_URL`: Optional webhook for alerts.

## Local run (Windows/Linux)

```bash
npm run start
```

Test scripts:

```bash
npm run test:status
npm run test:ack
```

Notes:
- Use `path.join`-based config paths; no OS-specific path separators are required.
- `cross-env` is used in npm scripts so env handling works on both Windows and Linux.
- WhatsApp client uses `whatsapp-web.js` + `LocalAuth` (session files under `.wwebjs_auth/` and `.wwebjs_cache/`).

## Docker run

Build:

```bash
npm run docker:build
```

Run:

```bash
npm run docker:run
```

The Docker image:
- Uses `node:20-bullseye-slim`
- Installs Google Chrome + Puppeteer runtime dependencies
- Uses multi-stage build for production image size control
- Reads runtime environment variables from `.env`

Default in container:
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome`

## Troubleshooting

- DNS or upstream connection failures:
  - Verify network/DNS in host/container.
  - Confirm `HOME_URL`, `STATUS_URL`, `FORM_URL`, `ACK_URL` values.
- Puppeteer launch issues:
  - In Docker, keep `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome`.
  - If sandbox errors appear in restricted containers, set `PUPPETEER_DISABLE_SANDBOX=true`.
- Low memory / Chromium crashes:
  - Increase container memory.
  - Keep `--disable-dev-shm-usage` in Puppeteer args (default behavior).
  - Reduce parallel bot work if applicable.

## Security

- Do not commit real `.env` values.
- `.dockerignore` excludes `.env` and local session/cache artifacts by default.
