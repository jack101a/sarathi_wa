Agent:
Codex audit. No files modified.

Scope inspected:
packages/gateway-wa, packages/common/src/commandNormalizer.js, packages/common/src/interactiveFlowService.js, packages/common/src/requestPipeline.js, related top-level tests.

Files inspected:
packages/gateway-wa/src/client.js, packages/gateway-wa/src/heartbeat.js, packages/gateway-wa/src/index.js, packages/gateway-wa/src/messageHandler.js, packages/gateway-wa/src/responseDelivery.js, packages/common/src/commandNormalizer.js, packages/common/src/interactiveFlowService.js, packages/common/src/requestPipeline.js, packages/common/src/jobRepository.js, packages/common/src/authorizationRepository.js, tests/testCommandNormalizer.js, tests/testInteractiveFlowChoices.js, tests/testReceiptInput.js.

Launch blockers:

- Failover can get stuck with no active gateway. `wa:active` has no TTL and primary only uses `SETNX` on startup. If failover becomes active, then fails or is removed, primary will keep returning inactive because `wa:active` still points at the old failover instance. See `packages/gateway-wa/src/heartbeat.js:11-13`, `33-39`, `48-55`.
- Menu choice parsing can accidentally run Form 1 from a DOB typed with spaces. With an active application menu, `03 01 2008` parses as numeric choices, and choice `3` maps to Form 1. Premium users can get multiple jobs from one date-like reply. See `packages/common/src/interactiveFlowService.js:55-63`, `109-126`.

High risk:

- `commandNormalizer`'s multi-track detector matches every message because the regex is fully optional: `/^(?:track\s+)?(?:dl\s+)?/`. Any message containing two 8-15 digit tokens and no DOB can become `track_multiple`, even if it starts with another command. See `packages/common/src/commandNormalizer.js:62-76`.
- Application menu accepts space-separated numeric choices. That supports `1 2`, but also treats malformed dates like `01 02 2003` as choices. For premium/admin sessions, valid choices are extracted and queued; for free users it returns "Multiple option selection..." instead of explaining the bad date/input. See `packages/common/src/interactiveFlowService.js:55-63`, `103-126`.
- Response delivery dedup claims the Redis key before WhatsApp send. If `client.sendMessage` fails after the claim, other gateways skip the same response and there is no retry path except media-caption fallback in the same failing handler. See `packages/gateway-wa/src/responseDelivery.js:19-28`, `41-59`.
- DL interactive menu is not filtered by plan/service permissions. It always shows DL Info, Extract, Renewal, Duplicate, Replacement; later `requestPipeline` may block unauthorized services. This is a user-facing flow mismatch. See `packages/common/src/interactiveFlowService.js:14-21`, `195-207`.

Medium risk:

- Invalid numeric menu choices silently kill the active flow. Example `99` during an app menu deletes `session:flow:*`, falls through to normal parsing, and usually produces no useful reply. See `packages/common/src/interactiveFlowService.js:77-132`, `packages/gateway-wa/src/messageHandler.js:386-392`.
- Multi-select app menu sends one "Processing..." reply per successfully queued command, so `2,3` creates two immediate replies before worker responses. This is a two-reply/multi-reply bug. See `packages/gateway-wa/src/messageHandler.js:332-367`.
- `stop` clears OTP and DOB sessions but not `session:flow:*`. A user who sends `stop` during an application/DL/LL menu receives no reply and the menu remains active until expiry. See `packages/gateway-wa/src/messageHandler.js:33-40`, `412-422`.
- Duplicate WA message handling depends on Redis. If Redis errors during incoming dedup, processing continues and can create duplicate jobs. See `packages/gateway-wa/src/messageHandler.js:225-235`.
- Duplicate job protection is per WhatsApp message id and command. A user resending the same paid command as a new WhatsApp message creates another job. That may be acceptable, but it does not protect against accidental double-send with different message IDs. See `packages/gateway-wa/src/messageHandler.js:573-578`, `packages/common/src/jobRepository.js:20-29`.

Low risk:

- Confirmed direct parsing workflows: `track DL <app> <dob>`, `track RC <rc>`, `app <app> <dob>`, bare `<app> <dob>`, `dl <dlNo> <dob>`, `ll <llNo> <dob>`, `topup`, and admin-only `payfee` are covered by smoke tests.
- Confirmed full application-number plus DOB does not parse as menu choices: `2435332026 03-01-2008` returns no flow choices in `tests/testInteractiveFlowChoices.js:10`.
- Confirmed outgoing self-message dedup exists for bot-sent messages, and old WhatsApp replay messages are ignored by timestamp. See `packages/gateway-wa/src/client.js:86-120`.
- User-facing messages are inconsistent: Hindi/Hinglish parse errors are detailed, but unauthorized/non-admin admin commands are silent, invalid menu choices are silent, and generic gateway failures use English only.

Missing tests:

- Active app menu plus malformed/spaced DOB: `03 01 2008`, `01 02 2003`, `3`.
- Active app menu wrong Form 1 selection, especially choice `3`.
- Active flow `stop` should clear `session:flow:*`.
- Invalid menu choice should preserve or clear session intentionally and reply with an invalid-choice message.
- Non-premium multi-select app menu behavior.
- Premium multi-select should avoid duplicate immediate replies or intentionally assert one summary reply.
- `commandNormalizer` should not parse non-track messages with two numbers as `track_multiple`.
- DL menu permission filtering for free vs premium vs admin.
- Failover stale `wa:active` scenarios and primary/failover recovery.
- Response delivery claim-before-send failure behavior.
- Redis dedup failure behavior for duplicate incoming WhatsApp messages.
- End-to-end tests around `messageHandler` ordering: OTP session, DOB session, flow session, command parsing.

Questions:

- Is automatic primary failback intended, or should failover remain active until manual intervention? Current code does neither safely if the active failover disappears.
- Should space-separated menu choices be supported, or should multi-select require comma/plus/slash to avoid date collisions?
- Should a bare `dl <number> <dob>` open a menu or directly run DL Info? Tests expect direct DL Info from the normalizer, but WhatsApp interactive flow intercepts it and opens a menu first.
- Should non-admin `payfee`/`bookslot` remain silent, or should users get a permissions message?

Recommended fixes:
1. Make `session:flow` input parsing stricter: reject date-like numeric sequences, require explicit delimiters for multi-select, add invalid-choice replies, and make `stop` clear flow sessions.
2. Fix `commandNormalizer` multi-track detection so it only runs for actual `track`/`track dl` inputs, then add negative tests for other commands containing multiple numbers.
3. Rework failover state with a TTL/lease on `wa:active`, heartbeat-based ownership renewal, and response delivery dedup that claims after successful send or has a retryable delivery state.
