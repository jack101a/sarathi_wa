const assert = require('assert');
const {
  extractAppNoAndDob,
  normalizeDob,
} = require('../src/services/commandInputService');

function run() {
  const direct = extractAppNoAndDob('track 123456789012 17/03/1990');
  assert.strictEqual(direct.appNo, '123456789012');
  assert.strictEqual(direct.dob, '17-03-1990');

  const embedded = extractAppNoAndDob('Application No 123456789012 DOB 1990-03-17');
  assert.strictEqual(embedded.appNo, '123456789012');
  assert.strictEqual(embedded.dob, '17-03-1990');

  const onlyAppNo = extractAppNoAndDob('track 123456789012');
  assert.strictEqual(onlyAppNo.appNo, '123456789012');
  assert.strictEqual(onlyAppNo.dob, '');

  assert.strictEqual(normalizeDob('17.3.1990'), '17-03-1990');
  assert.strictEqual(normalizeDob('1990/03/17'), '17-03-1990');

  console.log('PASS - command input parsing');
}

run();
