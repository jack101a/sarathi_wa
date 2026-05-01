# Authorized WhatsApp Identity-Link Tasks (Strict Execution)

## Mandatory Instructions

1. Follow tasks in exact order.
2. Do not change scope beyond this file and plan.
3. Do not skip tests.
4. Do not keep WA user allowlist hardcoded in env.
5. Keep admin identities env-based.

## Task 0: Read and confirm context

- [ ] Read [AUTHORIZED_ACCESS_PLAN.md](E:\codex\sarathiwa_bot\docs\AUTHORIZED_ACCESS_PLAN.md).
- [ ] Inspect [src/bot.js](E:\codex\sarathiwa_bot\src\bot.js) for WA message events and auth gate.
- [ ] Inspect [src/telegramBot.js](E:\codex\sarathiwa_bot\src\telegramBot.js) for admin command routing.
- [ ] Inspect [src/core/auth.js](E:\codex\sarathiwa_bot\src\core\auth.js).
- [ ] Inspect current auth service/store modules if present.

## Task 1: SQLite schema for verification + identity links

Files:

- `src/services/authorizationRepository.js` (create or refactor)
- DB file runtime path (default `data/authz.sqlite`)

Checklist:

- [ ] Create `auth_users`.
- [ ] Create `auth_user_identities`.
- [ ] Create `auth_verifications`.
- [ ] Create `authorized_groups`.
- [ ] Add required indexes and uniqueness constraints.
- [ ] Add migration-safe initialization.

Definition of done:

- [ ] DB initializes on startup without manual intervention.
- [ ] Re-running init is safe and idempotent.

## Task 2: Normalization + identity extraction module

Files:

- `src/services/authorizationNormalizer.js` (new or refactor)

Checklist:

- [ ] Normalize admin input phone to digits-only canonical form.
- [ ] Normalize outbound WA target to `<phone>@c.us`.
- [ ] Normalize inbound identity strings for `@c.us`, `@lid`, `@g.us`.
- [ ] Implement extractor that reads all relevant message identity fields.
- [ ] Return structured identity object for downstream linking.

Definition of done:

- [ ] Identity extraction is deterministic and unit-testable for sample payloads.

## Task 3: Verification service

Files:

- `src/services/waVerificationService.js` (new)

Checklist:

- [ ] Implement `startVerification(phone, actor, viaChannel)`.
- [ ] Generate random 6-char alphanumeric code.
- [ ] Persist pending verification with TTL.
- [ ] Implement resend/cancel/status handlers.
- [ ] Implement `consumeVerificationMessage(messageText, identityContext)` for `AUTH <phone> <code>`.
- [ ] On success, link observed identity/identities to canonical phone.
- [ ] Mark token single-use and verified.

Definition of done:

- [ ] Pending, verified, expired, cancelled states enforced correctly.

## Task 4: Authorization service integration

Files:

- `src/services/authorizationService.js`
- `src/core/auth.js`

Checklist:

- [ ] Update WA authorization to use linked identities table.
- [ ] Keep owner/admin env bypass rules.
- [ ] Keep group authorization from DB `authorized_groups`.
- [ ] Ensure remove user revokes all linked identities.

Definition of done:

- [ ] `@lid` authorized correctly after verification.

## Task 5: WhatsApp command + verification message handling

Files:

- `src/bot.js`

Checklist:

- [ ] Add admin commands:
- [ ] `auth add wa user <phone>`
- [ ] `auth resend wa user <phone>`
- [ ] `auth cancel wa user <phone>`
- [ ] `auth status wa user <phone>`
- [ ] `auth remove wa user <phone>`
- [ ] `auth list wa users`
- [ ] `auth add wa group <group_id>`
- [ ] `auth remove wa group <group_id>`
- [ ] `auth list wa groups`
- [ ] Detect and process user verification messages:
- [ ] `AUTH <phone> <code>`
- [ ] Ensure verification handling is checked before generic unauthorized drop where required.

Definition of done:

- [ ] A non-authorized target user can complete verification message flow successfully.

## Task 6: Telegram admin-side command support

Files:

- `src/telegramBot.js`

Checklist:

- [ ] Support same admin auth commands for WA user onboarding.
- [ ] Trigger WA verification start from Telegram admin command.
- [ ] Provide clear success/error/status messages.

Definition of done:

- [ ] TG admin can onboard WA users end-to-end.

## Task 7: Env/config cleanup and migration

Files:

- `src/config/config.js`
- `.env.example`
- startup bootstrap path

Checklist:

- [ ] Keep admin env keys only for admin identity (`WHATSAPP_PHONE_NUMBER`, `ADMIN_USERS`, `AUTHORIZED_TG_ADMINS`).
- [ ] Keep optional DB path key (`AUTHZ_DB_PATH`).
- [ ] Add one-time migration from legacy WA user allowlists into `auth_users` + default `@c.us` identity.
- [ ] Ensure migration is idempotent and logged.

Definition of done:

- [ ] System runs without requiring env WA user allowlist entries.

## Task 8: Tests (mandatory)

Files:

- `tests/` add/update test files

Required coverage:

- [ ] Start verification creates pending token.
- [ ] Token format and expiry behavior.
- [ ] Correct `AUTH <phone> <code>` consumes pending record.
- [ ] Wrong code fails without linking.
- [ ] Expired code fails.
- [ ] Successful verification links `@c.us` and observed `@lid` identity.
- [ ] WA auth passes after link and fails before link.
- [ ] Admin resend/cancel/status commands.
- [ ] Remove user revokes all linked identities.
- [ ] Group authorization unaffected.

Definition of done:

- [ ] All auth/verification tests pass locally.

## Task 9: Documentation updates

Files:

- `README.md`
- `docs/AI_AGENT_GUIDE.md`

Checklist:

- [ ] Document onboarding flow with example:
`auth add wa user 917715055466` then user replies `AUTH 917715055466 AU3D7D`.
- [ ] Document admin-only command list.
- [ ] Document DB tables at a high level.

Definition of done:

- [ ] Maintainer can operate feature from docs only.

## Task 10: Manual QA script

Runbook:

1. From admin WA or TG: `auth add wa user 917715055466`.
2. Confirm bot sends token message to target WA chat.
3. From target user account reply exact token.
4. Confirm status becomes verified.
5. Confirm target can run `alive`.
6. Confirm same user still works if subsequent event sender appears as `@lid`.
7. Remove user and verify blocked again.

- [ ] Record evidence in PR description (commands + outcomes).

