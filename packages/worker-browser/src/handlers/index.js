'use strict';
/**
 * worker-browser handlers index
 *
 * Each handler module wraps one or more related browser automation services
 * from the legacy monolith (src/services/) without rewriting business logic.
 *
 * All logic is currently handled inline in processor.js for simplicity.
 * This file serves as the entry point for future modularisation.
 *
 * Handlers:
 *   dlRenewal.js  — DL renewal, DL apply OTP flows
 *   llPrint.js    — LL Print and LL Edit OTP flows
 *   payment.js    — Fee payment, fee print, slot booking
 *   dlInfo.js     — DL info lookup
 *   mobileUpdate.js — Mobile number update flow
 */

module.exports = {};
