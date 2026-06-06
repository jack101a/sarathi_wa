Agent:
Codex

Scope inspected:
Service-by-service automation map:
- `apply_dl_start`: worker prompts OTP, `applyDlService` logs in by LL/DOB, retries captcha, generates OTP, submits Form 1, final captcha submit, sends ack screenshot/formset.
- `dl_renewal_start`: worker prompts OTP, `dlRenewalService` logs in by DL/DOB, selects RTO/service/reason/Form 1, final captcha submit, sends slip/formset.
- `llprint_start`: Firefox persistent profile, mobile OTP, background captcha priming, final OTP, PDF download/fallback capture.
- `lledit_start`: fetches target info, performs LL edit flow, OTP, form fill, final submit.
- `pay_fee_start` / `fee_print_start`: fee calculation, QR payment wait, receipt print/download or screenshot fallback.
- `slot_booking_start`: app/DOB login, calendar screenshot, user slot choice, booking OTP, confirmation PDF/screenshot.
- `dl_info_start`: browser login to DL renewal details page, parses DL info, renders image.
- Track/status/form/ack flows: mostly HTTP/session based, render snapshots/PDFs, no portal dialog capture except ack auto-accepts dialogs.
- Mobile update: has global dialog capture and `MOBILE_PORTAL_MESSAGE` for Aadhaar OTP generation only.

Files inspected:
- `packages/worker-browser/src/processor.js`
- `packages/worker-browser/src/engines/*.js`
- `src/services/applyDlService.js`
- `src/services/dlRenewalService.js`
- `src/services/llPrintService.js`
- `src/services/llEditService.js`
- `src/services/paymentService.js`
- `src/services/slotBookingService.js`
- `src/services/mobileUpdateService.js`
- `src/services/dlInfoService.js`
- `src/services/sarathiCommon.js`
- `src/services/statusService.js`
- `src/services/trackingSnapshotService.js`
- `src/services/ackService.js`
- `src/services/formService.js`
- `src/services/formsetService.js`
- `src/services/dl/*`
- `packages/common/src/userFacingErrors.js`
- `src/utils/failureLogger.js`
- `tests/testApplyDlPortalDialogs.js`

Launch blockers:

- DL renewal terminal portal/business errors are plain `Error`s, not non-retryable public errors. "Application already exist", `Govt Portal: ...`, and rejected OTP can retry under BullMQ and then become the generic user message.
- LL print OTP trigger loop is unbounded: `while (!otpTriggered)` has no max attempts or wall-clock timeout, so captcha/portal failure can hang a browser worker indefinitely.
- Apply DL final submit accepts all dialogs and does not inspect/store final submit dialog text. A terminal rejection during final submit can be swallowed, retried as "captcha mismatch", then reported generically.
- Payment receipt and slot booking print flows treat missing download as success by screenshot fallback without validating that the page is an actual receipt/booking confirmation.
- `dlServicePipeline.js` appears test-mode/unsafe for launch: launches with `headless: false`, waits for manual OTP up to 5 minutes, and `dlSubmitManager` logs "TEST MODE" and skips final submit.

High risk:

- User often does not receive portal dialog text. Only `PORTAL_BUSINESS_RULE` and `MOBILE_PORTAL_MESSAGE` preserve public text in `userFacingErrors`; most `Govt Portal:` and `Portal rejected OTP:` messages are collapsed to a generic failure.
- Retry policy is too broad. Non-retryable user/portal errors are retried unless explicitly marked. This can re-submit captcha/OTP/application steps and confuse users.
- Dialog handling is inconsistent: Apply DL login/OTP has some classification, DL renewal stores only existing-application specially, LL print/payment/slot mostly have no dialog handler, ack auto-accepts all dialogs.
- Several flows force-enable disabled portal controls and check many visible checkboxes automatically. That increases risk of bypassing portal validation state or selecting unintended declarations/services.
- Failure diagnostics are only consistently captured for DL renewal and DL info. Apply DL, payment, slot, LL print/edit mostly lose screenshots/DOM state on failure.

Medium risk:

- Captcha helper returns `false`, but many callers ignore it and click submit anyway.
- Timeout handling is mostly fixed sleeps plus selector waits. Slow portal pages can be misclassified as captcha failure, while real errors can be missed.
- Interactive timeout is user-safe, but not marked non-retryable. Depending BullMQ attempts, timed-out OTP sessions can be retried and re-open portal work.
- DL renewal service selection does not fail when the required service is not found in the legacy service; it logs a warning and proceeds.
- Existing application error in DL renewal is thrown as plain text, not public/non-retryable.
- LL print writes debug screenshots to project root and receipt/slot output files also use project root paths in places, which can leave stale artifacts.
- Slot booking accepts arbitrary date fallback to first available green slot if user date is not found, which may book a different date than requested.

Low risk:

- Mobile update has the best dialog capture pattern, but only Aadhaar OTP generation converts dialog text to a public error.
- Status/track/form/ack services are mostly HTTP/render flows, so portal dialog risk is lower, but ack auto-accepts dialogs without preserving text.
- Apply DL has one targeted unit test for terminal dialog classification.

Missing tests:

- DL renewal portal dialog classification and non-retryable conversion.
- Worker `getSafeJobFailureMessage` coverage for `Govt Portal`, OTP rejection, existing application, timeout, and portal business errors.
- LL print bounded retry/timeout behavior.
- Apply DL final submit dialog capture and user-visible portal message.
- Payment receipt validation when download fails.
- Slot booking date-not-found and confirmation validation.
- Mobile update wrong Aadhaar/mobile OTP handling.
- Screenshot/diagnostic capture on failures across all browser services.

Questions:

- What BullMQ attempt count is configured for browser jobs in production?
- Should wrong OTP be terminal immediately, or should the user be allowed to re-enter OTP without restarting the whole job?
- Should slot booking ever auto-fallback to the first available slot when the user requested a specific date?
- Is `src/services/dl/dlServicePipeline.js` still reachable, or is it dead/test-only code?

Recommended fixes:
1. Introduce one shared portal-error helper: capture dialog/page error text, classify terminal vs retryable, set `code`, `publicMessage`, and `retryable=false`; use it in Apply DL, DL renewal, LL print/edit, payment, slot, DL info, and mobile update.
2. Add bounded retry and wall-clock timeouts to every captcha/OTP/download loop, especially LL print OTP trigger, payment receipt, slot confirmation, and final submission loops.
3. Add failure diagnostics and user-message tests for each browser command before launch, with explicit assertions that portal dialog text reaches the user for terminal business-rule failures.
