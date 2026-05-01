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
2. Copy `config.example.yml` to `data/config.yml`
3. Fill in the core portal/runtime values in `data/config.yml`
4. Fill in the operational frontend values in `.env`
5. Install dependencies:

```bash
npm install
```

6. Start the app:

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
- Dynamic authorization can be managed via the `auth` admin command.
- Available auth commands: `auth list`, `auth add wa/tg user/group <id>`, and `auth remove wa/tg user/group <id>`.

- Core static config now lives in `data/config.yml` or the path pointed to by `CONFIG_FILE`.
- If `CONFIG_FILE` is missing at startup, the app will auto-create it from the bundled `config.example.yml`.
- `tests/manual/` is for helpful manual-testing utilities, not production code.
- `trash/` contains old temporary or debug artifacts and should not be treated as active runtime code.
