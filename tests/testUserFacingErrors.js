const assert = require('assert');
const { getSafeJobFailureMessage, isNonRetryableError } = require('../packages/common/src/userFacingErrors');

assert.strictEqual(
  getSafeJobFailureMessage({ code: 'INTERACTIVE_TIMEOUT' }),
  'No response was received within 5 minutes. Processing has stopped. Please start the service again.'
);

assert.strictEqual(
  getSafeJobFailureMessage({ code: 'INTERACTIVE_CANCELLED' }),
  'Processing stopped.'
);

const generic = getSafeJobFailureMessage(new Error('button #submit was not clickable'));
assert.strictEqual(
  generic,
  'We could not complete this service. Processing has stopped. Please check your details and try again.'
);
assert.doesNotMatch(generic, /button|selector|click|timeout exception/i);

assert.strictEqual(
  getSafeJobFailureMessage({
    code: 'MOBILE_PORTAL_MESSAGE',
    publicMessage: 'Aadhaar server is busy.',
  }),
  'Aadhaar server is busy.\n\nProcessing stopped. Please try again later.'
);

assert.strictEqual(
  getSafeJobFailureMessage({
    code: 'PORTAL_BUSINESS_RULE',
    publicMessage: 'Please Apply Your DL After 30 Days',
  }),
  'Please Apply Your DL After 30 Days\n\nProcessing stopped.'
);
assert.strictEqual(isNonRetryableError({ code: 'PORTAL_BUSINESS_RULE' }), true);
assert.strictEqual(isNonRetryableError({ retryable: false }), true);
assert.strictEqual(isNonRetryableError(new Error('captcha failed')), false);

console.log('User-facing error message tests passed.');
