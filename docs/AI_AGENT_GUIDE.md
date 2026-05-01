# AI Agent Guide

## Purpose

This document is the shortest reliable way for an AI agent to understand how this repository works without re-reading the entire codebase.

The project is a WhatsApp-first bot with optional Telegram support for:

- Sarathi DL status lookup
- Sarathi acknowledgement and form downloads
- Sarathi auto-tracking
- Vahan RC status lookup
- Vahan tracked-status notifications
- WhatsApp pairing-code notifications

## Repo Layout

### Runtime code

- `server.js`
  Starts the WhatsApp bot, Telegram bot, and schedulers.
- `src/bot.js`
  Main WhatsApp command router and interactive flow handler.
- `src/telegramBot.js`
  Telegram command router for Sarathi workflows.
- `src/config/config.js`
  Centralized environment parsing and defaults.
- `src/core/`
  Shared infra: auth, HTTP client/session logic, Puppeteer rendering.
- `src/services/`
  All main business logic.
- `src/commands/`
  Thin command handlers used by WhatsApp flow.

### Automated tests

- `tests/*.js`
  Fast or semi-live test scripts for important parsing and service flows.

### Manual-test helpers

- `tests/manual/whatsapp/chatIdHelper.js`
  Helper bot that replies with chat IDs.
- `tests/manual/whatsapp/listWhatsAppChats.js`
  Prints available WhatsApp chats.
- `tests/manual/vahan/vahanResearch.js`
  Legacy Vahan exploration script for manual debugging and experiments.

### Non-runtime leftovers

- `trash/`
  Old debug artifacts and temporary files that are not part of the main app flow.

## Startup Flow

### Entry

`server.js` does three things:

1. Starts the WhatsApp bot from `src/bot.js`
2. Starts the Telegram bot from `src/telegramBot.js`
3. Starts the Sarathi auto-track scheduler from `src/services/autoTrackService.js`

The Vahan tracker scheduler is started inside the WhatsApp bot bootstrap because it depends on the live WhatsApp client.

## Main Runtime Flows

### WhatsApp

`src/bot.js` is the main router.

Important responsibilities:

- Authorization checks
- Basic command parsing
- Interactive `add track` flow
- Vahan captcha session routing
- Sarathi command dispatch to `src/commands/*`

Important command families:

- Sarathi:
  - `track`
  - `add track`
  - `remove track`
  - `refresh track`
  - `appl`
  - `form1`
  - `form1a`
  - `form2`
  - `formset`
- Vahan:
  - `track rc <application_number>`
  - `add track rc <application_number> -tag`
  - `remove track rc <application_number>`
  - `list track`
  - `stop`

### Telegram

`src/telegramBot.js` supports Sarathi and Vahan command flows.

Telegram now supports:

- Sarathi lookups
- Sarathi tracking commands
- Vahan RC lookup
- Vahan captcha reply flow
- Vahan tracking commands

## Sarathi Workflow

### Status lookup

Main path:

- `src/commands/track.js`
- `src/services/trackingSnapshotService.js`
- `src/services/statusService.js`

How it works:

1. Parse app number and optional DOB
2. Fetch Sarathi status HTML and render image snapshot
3. Parse status details
4. Return image/caption to WhatsApp or Telegram

### Auto-tracking

Main path:

- `src/services/autoTrackService.js`
- `src/services/autoTrackStore.js`
- `src/services/chatNotifier.js`

How it works:

1. User adds a tracked application
2. Entry is stored in `data/tracked_applications.json`
3. Cron job runs on `AUTO_TRACK_CRON`
4. Current snapshot is compared to `lastSnapshot`
5. On change, notifier sends update
6. Dispatched items are removed automatically

## Vahan Workflow

### Interactive lookup

Main path:

- `src/services/vahanService.js`

How it works:

1. `track rc <appno>` starts a Vahan session
2. Bot bootstraps the Vahan page and captcha state
3. If auto-solve is enabled, solver tries the captcha first
4. If auto-solve succeeds, status card is rendered and sent
5. If auto-solve fails repeatedly, captcha is sent to the active transport chat
6. User replies in that same chat with captcha text
7. Authenticated session can then be reused for later app numbers

### Auto-solve policy

Current Vahan auto-solve behavior:

- Controlled by `VAHAN_CAPTCHA_AUTO_SOLVE`
- Maximum attempts from `VAHAN_CAPTCHA_MAX_ATTEMPTS`
- Retry jitter from `VAHAN_CAPTCHA_RETRY_MIN_MS` to `VAHAN_CAPTCHA_RETRY_MAX_MS`
- Default policy is 8 attempts with 3-5 second random delays

### Tracked Vahan updates

Main path:

- `src/services/vahanService.js`
- `src/services/vahanTrackStore.js`

How it works:

1. Vahan entries are stored in `data/vahan_tracked_applications.json`
2. Scheduler uses `VAHAN_TRACK_CRON`
3. Reuses authenticated Vahan sessions when possible
4. Compares current status snapshot against `lastSnapshot`
5. Sends status image to the configured WhatsApp update chat
6. Removes items when RC dispatch status becomes meaningful

## Notification Plumbing

### Shared notifier layer

`src/services/chatNotifier.js` is the shared notification abstraction.

Use it when adding new outbound notification behavior.

Current capabilities:

- WhatsApp text
- WhatsApp image/media
- Telegram text
- Telegram photo
- Telegram notification target resolution

### Telegram targets

Telegram fallback notifications are sent to:

1. `TELEGRAM_NOTIFY_CHAT_IDS` if configured
2. Otherwise `AUTHORIZED_TG_USERS + AUTHORIZED_TG_GROUPS`

## Dynamic Authorization

The app uses a dynamic authorization system allowing admins to manage access allowlists at runtime.

### Data Storage

- `data/authorized_entities.json`
  Stores the dynamic allowlist. Schema contains `whatsapp` and `telegram` arrays for `users`, `groups`, and `admins`.

### Admin Commands

Both WhatsApp and Telegram support the `auth` admin command:

- `auth help`
- `auth list`
- `auth add wa/tg user/group/admin <id>`
- `auth remove wa/tg user/group/admin <id>`

## Environment Variables You Usually Care About

### Core

- `CONFIG_FILE`
- `SESSION_NAME`

### WhatsApp

- `WHATSAPP_PHONE_NUMBER`

### Telegram

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_NOTIFY_CHAT_IDS`

### Sarathi tracking

- `AUTO_TRACK_CRON`
- `AUTO_TRACK_STORE_FILE`
- `AUTO_TRACK_UPDATE_CHAT_ID`

### Vahan tracking

- `VAHAN_TRACK_CRON`
- `VAHAN_TRACK_STORE_FILE`
- `VAHAN_TRACK_UPDATE_CHAT_ID`
- `VAHAN_CAPTCHA_AUTO_SOLVE`
- `VAHAN_CAPTCHA_MODEL_PATH`
- `VAHAN_CAPTCHA_MAX_ATTEMPTS`
- `VAHAN_CAPTCHA_RETRY_MIN_MS`
- `VAHAN_CAPTCHA_RETRY_MAX_MS`

## Config Model

The app uses a two-layer config model:

1. `data/config.yml`
   Holds stable portal and runtime configuration
2. `.env`
   Holds operational frontend credentials, access lists, notification targets, and scheduler overrides

If `data/config.yml` is missing at startup, the app auto-seeds it from the bundled `config.example.yml`.

At least one of these must be configured for the app to start:

- `WHATSAPP_PHONE_NUMBER`
- `TELEGRAM_BOT_TOKEN`

## Where To Edit Things

### Add or change WhatsApp command handling

Edit `src/bot.js`, then the target command/service.

### Change Sarathi tracking behavior

Edit:

- `src/services/autoTrackService.js`
- `src/services/autoTrackStore.js`
- `src/services/chatNotifier.js`

### Change Vahan captcha/session behavior

Edit:

- `src/services/vahanService.js`
- `src/services/vahanCaptchaSolver.js`

### Change config defaults or add env vars

Edit:

- `src/config/config.js`
- `.env.example`
- `.env.docker.example`

## Tests To Run

Fastest useful checks:

- `node tests/testCommandInput.js`
- `node tests/testVahanService.js`

Useful live or semi-live checks:

- `node tests/testStatus.js`
- `node tests/testAck.js`
- `node tests/testTrackingSnapshot.js`
- `node tests/testRefreshTrack.js`

Manual helpers:

- `npm run chatid:helper`
- `npm run chatids`
- `npm run manual:vahan-research`

## Known Oddities

- `tests/manual/vahan/vahanResearch.js` is intentionally not part of runtime and may lag behind production implementation details.
- The repo mostly uses Node scripts instead of a formal test runner like Jest or Vitest.
- There is no enforced formatter/linter config yet, so consistency is maintained manually.

## Rules Of Thumb For Future Agents

- Start with this guide, then read only the service you are changing.
- Prefer editing shared abstractions instead of adding new one-off notification logic.
- Treat `src/config/config.js` as the single source of truth for env-driven behavior.
- Do not confuse `tests/manual/` with runtime code.
- Do not delete `.wwebjs_auth/` or `.wwebjs_cache/` unless the user explicitly asks.
- Prefer adding focused script-style regression tests in `tests/` when changing critical behavior.
