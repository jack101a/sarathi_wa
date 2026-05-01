# Authorized WhatsApp Identity-Link Plan (Code Verification + LID Mapping)

## Objective

Implement a strict onboarding flow so adding a WhatsApp user by phone number works even with modern WhatsApp `@lid` identities.

Core requirement:

1. Admin adds a mobile number from WhatsApp or Telegram.
2. Bot sends a one-time verification code message to that mobile on WhatsApp.
3. User replies with the same token.
4. Bot captures real sender identity from incoming events and links all identities to that phone.
5. Authorization then works for linked `@c.us` and `@lid` forms.

## Why This Is Needed

1. Current allowlist by phone alone is insufficient for `@lid` sender formats.
2. `@lid` values are not always derivable from phone number.
3. Reliable mapping needs an explicit verification handshake from the real user account.

## Product Behavior (Final)

## Admin-triggered add

Command:

1. `auth add wa user 917715055466`

Expected flow:

1. System creates a pending verification request for normalized phone `917715055466`.
2. System generates random 6-character alphanumeric code (example: `AU3D7D`).
3. System sends WhatsApp message to `917715055466@c.us`:
`AUTH 917715055466 AU3D7D`
4. System replies to admin: verification initiated, waiting for response.

## User verification

1. User replies from their WhatsApp with token containing exact pair:
`AUTH 917715055466 AU3D7D`
2. Bot validates pending request, expiry, and token.
3. Bot captures sender identity from message context.
4. Bot links identity to canonical phone and marks verification complete.

## Linked identities model

For one canonical phone, store many WhatsApp identities:

1. Deterministic identity: `<phone>@c.us`
2. Observed runtime identities from verified messages:
- `<someid>@lid`
- any additional WA sender ids observed later for same verified account

Result:

1. Any linked identity authorizes that user.

## Storage Strategy (SQLite)

Use SQLite as single source of truth for auth entities.

Recommended tables:

1. `auth_users`
Columns:
`id`, `channel`, `canonical_phone`, `is_active`, `created_at`, `updated_at`

2. `auth_user_identities`
Columns:
`id`, `auth_user_id`, `identity_type` (`wa_cus|wa_lid|wa_other`), `identity_value`, `verified_at`, `last_seen_at`, `is_active`
Unique on active `identity_value`.

3. `auth_verifications`
Columns:
`id`, `channel`, `canonical_phone`, `code`, `status` (`pending|verified|expired|cancelled`), `requested_by`, `requested_via` (`wa|tg`), `expires_at`, `verified_at`, `verified_identity`, `meta_json`

4. `authorized_groups`
Columns:
`id`, `channel` (`wa|tg`), `group_id`, `is_active`, `created_by`, `created_at`

## Authorization Rules

## WhatsApp private chat

Authorize if any true:

1. Sender phone matches admin env rule.
2. Sender identity (`message.from`/`message.author`) exists in `auth_user_identities` active set.
3. Fallback phone extraction matches an active verified `auth_users.canonical_phone`.

## WhatsApp group chat

Authorize if group ID is approved in `authorized_groups` for `wa`.

## Telegram

1. Keep Telegram admin identities env-based.
2. Telegram can issue admin mutation commands.
3. Telegram user/group authorization still uses DB-managed entities.

## Sender Identity Extraction Policy

For each incoming WA message:

1. Extract and persist all meaningful identity fields when present:
- `message.from`
- `message.author` (group contexts)
- any stable participant id field available from event payload
2. Normalize into exact identity strings (`*@c.us`, `*@lid`, `*@g.us`).
3. During verification success, bind observed private-user identities to canonical phone.

## Verification Lifecycle

1. Create pending record on `auth add wa user <phone>`.
2. TTL default: 15 minutes.
3. If token reply arrives after TTL, mark expired and reject.
4. Allow admin to resend:
`auth resend wa user <phone>`
5. Allow admin cancel:
`auth cancel wa user <phone>`

## Command Contract

Admin commands (WhatsApp + Telegram):

1. `auth add wa user <phone>`
2. `auth resend wa user <phone>`
3. `auth cancel wa user <phone>`
4. `auth status wa user <phone>`
5. `auth remove wa user <phone>`
6. `auth list wa users`
7. `auth add wa group <group_id>`
8. `auth remove wa group <group_id>`
9. `auth list wa groups`
10. `auth help`

User verification message:

1. `AUTH <phone> <code>`

## Security Requirements

1. Code must be cryptographically random enough for OTP-style usage.
2. One active pending request per phone at a time.
3. Rate-limit resend attempts per phone.
4. Do not authorize based only on matching text; require pending challenge + matching source context.
5. Log verification events without exposing sensitive internals beyond needed diagnostics.

## Backward Compatibility

1. Existing authorized numbers should be migratable into `auth_users`.
2. For each migrated phone, insert default `<phone>@c.us` identity.
3. `@lid` linkage is learned through verification or later trusted linking flow.

## Acceptance Criteria

1. Admin can start verification from WA or TG.
2. Bot sends challenge message to target WhatsApp number.
3. Correct token reply links runtime WA identity to canonical phone.
4. After success, user is authorized even if sender appears as `@lid`.
5. Remove user revokes all linked identities.
6. Flow handles expiry, resend, cancel correctly.
7. Group authorization remains independent and functional.

## Risks and Mitigations

1. Risk: message goes to wrong chat id format.
Mitigation: standardize outbound to `<phone>@c.us`, with retry/reporting.

2. Risk: user replies from another account.
Mitigation: link only identity that sent correct token for active challenge.

3. Risk: replay attacks using old token.
Mitigation: single-use token + expiry + status transition enforcement.

4. Risk: ambiguous multi-device identities.
Mitigation: allow multiple linked identities per canonical phone; track `last_seen_at`.

