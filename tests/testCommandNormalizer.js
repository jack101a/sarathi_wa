const assert = require('assert');
const { parseCommand } = require('../packages/common/src/commandNormalizer');

function parse(text, isAdmin = false, user = { subscription_plan: 'premium' }) {
  return parseCommand(text, false, user, isAdmin);
}

assert.deepStrictEqual(parse('track DL 2982778275 01-02-2003'), {
  success: true,
  type: 'track',
  payload: { appNo: '2982778275', dob: '01-02-2003' },
});

assert.deepStrictEqual(parse('track RC MH26021234567'), {
  success: true,
  type: 'track_rc',
  payload: { appNo: 'MH26021234567' },
});

assert.deepStrictEqual(parse('app 2982778275 01-02-2003'), {
  success: true,
  type: 'appl_pdf',
  payload: { appNo: '2982778275', dob: '01-02-2003', mobile: '' },
});

assert.deepStrictEqual(parse('stop'), {
  success: true,
  type: 'stop',
});

assert.strictEqual(parse('payfee 2982778275 01-02-2003').silent, true);
assert.strictEqual(parse('payfee 2982778275 01-02-2003', true).type, 'pay_fee_start');

console.log('Command normalizer smoke tests passed.');
