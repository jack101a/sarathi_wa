const assert = require('assert');
const {
  isRegisterCommand,
  normalizeName,
  normalizeIndianMobile,
  outboundJidForMobile,
} = require('../packages/gateway-wa/src/selfRegistrationUtils');

assert.strictEqual(isRegisterCommand('/register'), true);
assert.strictEqual(isRegisterCommand('/register now'), true);
assert.strictEqual(isRegisterCommand('register'), false);
assert.strictEqual(isRegisterCommand('/help'), false);

assert.strictEqual(normalizeName('  Ravi   Kumar  '), 'Ravi Kumar');
assert.strictEqual(normalizeName('A'), 'A');

assert.strictEqual(normalizeIndianMobile('7715055466'), '7715055466');
assert.strictEqual(normalizeIndianMobile('+91 77150 55466'), '7715055466');
assert.strictEqual(normalizeIndianMobile('07715055466'), '7715055466');
assert.strictEqual(normalizeIndianMobile('12345'), '');
assert.strictEqual(normalizeIndianMobile('1715055466'), '');

assert.strictEqual(outboundJidForMobile('7715055466'), '917715055466@c.us');

console.log('Self-registration utility tests passed.');
