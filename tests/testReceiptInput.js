const assert = require('assert');
const { parseCommand } = require('../packages/common/src/commandNormalizer');

const parsed = parseCommand('fees 2982778275 01-02-2003', false, { subscription_plan: 'premium' }, false);
assert.strictEqual(parsed.success, true);
assert.strictEqual(parsed.type, 'fee_print_start');
assert.strictEqual(parsed.payload.dob, '01-02-2003');

console.log('Receipt command smoke test passed.');
