# Sarathi WA Bot

WhatsApp-first bot for Sarathi and Vahan workflows, with optional Telegram support for notifications and Sarathi commands.

## Start Here

Read [docs/AI_AGENT_GUIDE.md](docs/AI_AGENT_GUIDE.md) first.

That guide is the main project map for future agents and contributors. It covers:

- architecture
- runtime flow
- Sarathi tracking
- Vahan captcha/session flow
- config variables
- repo layout
- tests and manual helpers

## Repo Layout

```text
src/            runtime code
tests/          automated and script-style tests
tests/manual/   manual helpers and research scripts
trash/          non-runtime leftover artifacts
docs/           documentation
```

## Setup

1. Copy `.env.example` to `.env`
2. Fill in the required Sarathi values:
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

4. Start the app:

```bash
npm run start
```

## Useful Commands

```bash
npm run start
npm run test:status
npm run test:ack
npm run test:vahan
npm run chatid:helper
npm run chatids
npm run manual:vahan-research
```

## Notes

- WhatsApp auth persists in `.wwebjs_auth/` and `.wwebjs_cache/`.
- `tests/manual/` is for helpful manual-testing utilities, not production code.
- `trash/` contains old temporary or debug artifacts and should not be treated as active runtime code.
