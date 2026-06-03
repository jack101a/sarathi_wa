const assert = require('assert');
const { parseCommand } = require('../packages/common/src/commandNormalizer');

const parsed = parseCommand('appl 2982778275 01-02-2003', false, { subscription_plan: 'premium' }, false);
assert.strictEqual(parsed.success, true);
assert.strictEqual(parsed.type, 'appl_pdf');
assert.strictEqual(parsed.payload.appNo, '2982778275');

console.log('Acknowledgement command smoke test passed.');
