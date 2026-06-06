Agent:
Codex

Scope inspected:
Billing flow map: request auth -> plan/service/rate check -> heavy credit availability check -> reserve credits -> create job with `__billing` -> enqueue -> worker marks running -> on success marks completed then finalizes/deducts credits -> on final failure releases reserved credits.

Job state map: `pending` on insert -> `running` on worker start -> `completed` before billing finalize -> `failed` on worker failure path -> `cancelled` only through admin pending-job cancel.

Files inspected:
`packages/common/src/requestPipeline.js`, `jobRepository.js`, `authorizationRepository.js`, `authorizationService.js`, `serviceRepository.js`, `pricingRepository.js`, `planRepository.js`, `rateLimiter.js`, `queue.js`, `razorpayService.js`, `userFacingErrors.js`; `packages/worker-api/src/processor.js`; `packages/worker-browser/src/processor.js`; `packages/api/src/routes/adminRouter.js`; `packages/gateway-wa/src/messageHandler.js`; `packages/gateway-tg/src/messageHandler.js`; scheduler auto-track enqueue; legacy `src/core/jobQueue.js`.

Launch blockers:

- Heavy jobs are marked `completed` before credit finalization. A crash or repeated DB failure after `updateJobStatus(..., 'completed')` can leave the job successful with credits still reserved or not deducted. See `packages/worker-browser/src/processor.js:478-488` and `packages/worker-api/src/processor.js:282-292`.
- Admin cancellation does not release reserved heavy-job credits. `adminRouter` removes the BullMQ job and calls `jobRepository.cancelJob`, but `cancelJob` only marks `cancelled`; it does not inspect payload billing or release credits. See `packages/api/src/routes/adminRouter.js:763-773` and `packages/common/src/jobRepository.js:115-123`.
- Reservations are only an aggregate `auth_users.reserved_credits`, not job-scoped. `finalizeReservedCreditsForJob` and `releaseReservedCreditsForJob` can consume/release another job's reservation if the same job is finalized/released twice or jobs overlap. See `packages/common/src/authorizationRepository.js:505-553`.

High risk:

- Finalization is not idempotent by `job_id`. `credit_transactions` has no uniqueness guard for job deductions, and status updates are unconditional. A duplicate worker execution after another job reserves credits can charge the wrong reservation. See `authorizationRepository.js:526-540` and `jobRepository.js:55-63`.
- Concurrent limit and light/medium quota checks are check-then-create, not atomic. Parallel requests can all see the same active count/rate count and exceed `maxConcurrent` or daily/monthly limits. See `requestPipeline.js:67-82` and `rateLimiter.js:171-215`.
- Telegram job requests do not pass a `dedupKey`; duplicate Telegram updates can create separate jobs and separately bill. WhatsApp passes message-id dedup keys. Compare `packages/gateway-tg/src/messageHandler.js:410-414` with `packages/gateway-wa/src/messageHandler.js:573-578`.
- Admin manual `deduct` uses `deductCreditsAudited`, which floors balance at zero and records the requested amount, not the actual deducted amount. That can overstate spend and silently forgive over-deductions. See `authorizationRepository.js:490-500`.

Medium risk:

- Heavy billing is "per successful job", but success is defined as handler return, not delivery success or portal-side business completion. Some handlers can send partial outputs or swallow downstream errors and still return `{ ok: true }`.
- Non-retryable business errors depend on error codes. `PORTAL_BUSINESS_RULE` and `INTERACTIVE_CANCELLED` stop retries, but other business/user-input errors may retry unless services set `retryable = false`. See `userFacingErrors.js`.
- Group pricing overrides affect price resolution, but credits always come from the individual user wallet. There is no group pooled credit model. See `pricingRepository.js:179-187` and `requestPipeline.js:58-60`.
- Service registry cache is async/stale for up to 60 seconds, so service enable/disable, category, queue type, and credit cost changes can briefly route or bill using old data.

Low risk:

- Reserve/release operations are not audited in `credit_transactions`, so history cannot explain locked/released credits.
- `balance` displays raw `credits`, not available credits after `reserved_credits`; users with pending heavy jobs may see spendable balance that is not actually available.
- Legacy `src/core/jobQueue.js` still exists and ignores reservations, but package Docker/start scripts appear to use package workers. Keeping divergent billing code is operational risk if legacy workers are ever started.

Missing tests:

- Heavy success: reserve then finalize exactly once, with credit and reserved balance assertions.
- Heavy failure: reserve then refund only on final failed attempt.
- Admin pending-job cancellation releases reserved credits.
- Duplicate execution/idempotency: same `job_id` cannot deduct twice or consume another job's reservation.
- Telegram duplicate update handling.
- Concurrent heavy reservations for the same user.
- Concurrent light/medium requests at daily/monthly and `maxConcurrent` boundaries.
- Pricing precedence: user > group > plan > service > fallback.
- Manual admin add/deduct/set with reserved credits present.
- Crash/restart between completed status update and billing finalization.

Questions:

- Should group commands bill the sender's wallet, a group wallet, or a designated owner wallet?
- Should "successful heavy job" mean portal submission completed, user notification delivered, or handler returned without throwing?
- Should admin `set credits` preserve, clear, or validate existing `reserved_credits`?

Recommended fixes:
1. Add job-scoped credit reservations/ledger rows with unique `job_id`, and make reserve/finalize/release idempotent in one transaction.
2. Move billing finalization before marking `completed`, or combine billing and final job status update in a single DB transaction.
3. On admin cancel, load the job payload, release any job reservation, remove queue job, and mark `cancelled` atomically where possible.
