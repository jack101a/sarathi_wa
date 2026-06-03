const assert = require('assert');
const { parseCommand } = require('../packages/common/src/commandNormalizer');

const parsed = parseCommand('track RC MH26021234567', false, { subscription_plan: 'premium' }, false);
assert.strictEqual(parsed.success, true);
assert.strictEqual(parsed.type, 'track_rc');
assert.strictEqual(parsed.payload.appNo, 'MH26021234567');

console.log('Vahan command smoke test passed.');
