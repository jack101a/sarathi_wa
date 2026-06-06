const assert = require('assert');
const { getSafeJobFailureMessage } = require('../packages/common/src/userFacingErrors');

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

console.log('User-facing error message tests passed.');
