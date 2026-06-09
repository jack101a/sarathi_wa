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

assert.deepStrictEqual(parse('2982778275 01-02-2003'), {
  success: true,
  type: 'track',
  payload: { appNo: '2982778275', dob: '01-02-2003' },
});

assert.deepStrictEqual(parse('dl MH4720150008844 01-02-2003'), {
  success: true,
  type: 'dl_info_start',
  payload: { dlNo: 'MH47 20150008844', dob: '01-02-2003' },
});

assert.deepStrictEqual(parse('ll MH47/0050138/2026 01-02-2003'), {
  success: true,
  type: 'apply_dl_start',
  payload: { llNo: 'MH47 /0050138/2026', dob: '01-02-2003', mobile: '' },
});

assert.deepStrictEqual(parse('stop'), {
  success: true,
  type: 'stop',
});

assert.deepStrictEqual(parse('topup 500'), {
  success: true,
  type: 'topup',
  payload: { amount: 500 },
});

assert.strictEqual(parse('paid 412345678901').success, false);
assert.match(parse('paid 412345678901').error, /Manual UPI\/UTR wallet top-up is disabled/);

assert.strictEqual(parse('payfee 2982778275 01-02-2003').type, 'pay_fee_start');
assert.strictEqual(parse('payfee 2982778275 01-02-2003', true).type, 'pay_fee_start');

console.log('Command normalizer smoke tests passed.');
