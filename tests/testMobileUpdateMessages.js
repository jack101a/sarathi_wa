const assert = require('assert');
const {
  sanitizePortalMessage,
  isPortalFailureMessage,
  getMobileUpdateFailureMessage,
} = require('../src/utils/mobileUpdateMessages');

assert.strictEqual(
  sanitizePortalMessage('  Aadhaar   server is busy.\\nTry again.  '),
  'Aadhaar server is busy.\\nTry again.'
);
assert.strictEqual(isPortalFailureMessage('Aadhaar server is busy. Please try again.'), true);
assert.strictEqual(isPortalFailureMessage('OTP sent successfully.'), false);
assert.strictEqual(
  getMobileUpdateFailureMessage({ publicMessage: 'Aadhaar server is busy.' }),
  'Aadhaar server is busy.\n\nProcessing stopped. Please try again later.'
);

console.log('Mobile update message tests passed.');
