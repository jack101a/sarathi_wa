const assert = require('assert');
const { parseCommand } = require('../src/services/commandNormalizer');

function testMultiTrackCommand() {
  const premiumUser = { subscription_plan: 'premium' };
  const standardUser = { subscription_plan: 'standard' };

  console.log('🧪 Starting Multi-Track Command Normalizer Tests...');

  // 1. Premium User tracking multiple apps should succeed
  let res = parseCommand('track dl 842305226, 842513926, 842113126', false, premiumUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track_multiple');
  assert.deepStrictEqual(res.payload.appNos, ['842305226', '842513926', '842113126']);

  // Without "dl" keyword, using space separated
  res = parseCommand('track 842305226 842513926', false, premiumUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track_multiple');
  assert.deepStrictEqual(res.payload.appNos, ['842305226', '842513926']);

  // Admin User should succeed
  res = parseCommand('track dl 842305226,842513926', false, null, true);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track_multiple');
  assert.deepStrictEqual(res.payload.appNos, ['842305226', '842513926']);

  // 2. Standard User tracking multiple apps should be blocked
  res = parseCommand('track dl 842305226, 842513926', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('Multiple application tracking is only available for Premium plan users'));

  // 3. Command with DOB should not map to track_multiple (should map to single track)
  res = parseCommand('track dl 842305226 01-02-2003', false, premiumUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track'); // single tracking command type

  console.log('🎉 PASS - Multi-Track Command Normalizer tests passed successfully!');
}

testMultiTrackCommand();
