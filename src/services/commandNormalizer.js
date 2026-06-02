/**
 * commandNormalizer — monolith stub
 *
 * Delegates to @sarathi/common which contains the canonical implementation
 * including the billing commands: balance, topup, paid, history, plan.
 *
 * DO NOT add logic here — edit packages/common/src/commandNormalizer.js instead.
 */
module.exports = require('@sarathi/common').commandNormalizer;
