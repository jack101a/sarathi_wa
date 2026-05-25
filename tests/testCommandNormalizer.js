const assert = require('assert');
const { parseCommand, USER_HELP_TEXT, ERRORS } = require('../src/services/commandNormalizer');

function testCommandNormalizer() {
  const standardUser = { subscription_plan: 'standard' };
  const premiumUser = { subscription_plan: 'premium' };
  const adminUser = { subscription_plan: 'admin' };

  // 1. HELP COMMANDS
  let res = parseCommand('help', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'help');
  assert.strictEqual(res.message, USER_HELP_TEXT);

  res = parseCommand('मदद', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'help');

  // 2. ALIVE
  res = parseCommand('alive', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'alive');

  // 3. STOP
  res = parseCommand('stop', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'stop');

  // 4. DL Tracking - Standard User
  // Missing DOB
  res = parseCommand('track DL 2982778275', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));
  assert.ok(res.error.includes('<appl_no> <DOB>'));

  // Invalid DOB
  res = parseCommand('track DL 2982778275 invalid-dob', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('गलत जन्मतिथि'));

  // Correct DL tracking
  res = parseCommand('track DL 2982778275 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track');
  assert.strictEqual(res.payload.appNo, '2982778275');
  assert.strictEqual(res.payload.dob, '01-02-2003');

  // Premium User is no longer exempt for DL tracking (missing DOB)
  res = parseCommand('track DL 2982778275', false, premiumUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  // Admin User is no longer exempt
  res = parseCommand('track DL 2982778275', false, null, true);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  // 5. RC Tracking
  res = parseCommand('track RC MH26021234567', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track_rc');
  assert.strictEqual(res.payload.appNo, 'MH26021234567');

  // Plain track smart detection (no qualifier)
  // DL input without DOB -> should fail with missing DOB error
  res = parseCommand('track 2982778275', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  // DL input with DOB -> should succeed in DL tracking
  res = parseCommand('track 2982778275 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track');
  assert.strictEqual(res.payload.appNo, '2982778275');
  assert.strictEqual(res.payload.dob, '01-02-2003');

  // RC input without DOB -> should succeed in RC tracking
  res = parseCommand('track MH260507V1745659', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track_rc');
  assert.strictEqual(res.payload.appNo, 'MH260507V1745659');

  // 6. Form downloads
  res = parseCommand('form1 2982778275 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'form1');
  assert.strictEqual(res.payload.appNo, '2982778275');
  assert.strictEqual(res.payload.dob, '01-02-2003');

  res = parseCommand('form1 2982778275', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  res = parseCommand('form1 2982778275', false, premiumUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  // 7. Silent Admin Block
  res = parseCommand('track refresh', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.silent, true);

  res = parseCommand('track refresh', false, null, true);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'refresh_track');

  // 8. Image/Media ignoring
  res = parseCommand('track DL 2982778275 01-02-2003', true, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.ignore, true);

  // 9. NEW Smart Qualifier Tests for track add and track remove
  // Explicit RC addition
  res = parseCommand('track add rc MH26021234567', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'add_track_rc');
  assert.strictEqual(res.payload.appNo, 'MH26021234567');

  // Explicit DL addition
  res = parseCommand('track add dl 2982778275 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'add_track');
  assert.strictEqual(res.payload.appNo, '2982778275');
  assert.strictEqual(res.payload.dob, '01-02-2003');

  // Independent command explicit RC
  res = parseCommand('addtrack rc MH26021234567', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'add_track_rc');
  assert.strictEqual(res.payload.appNo, 'MH26021234567');

  // Explicit remove qualifier
  res = parseCommand('track remove rc MH26021234567', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'remove_track_rc');
  assert.strictEqual(res.payload.appNo, 'MH26021234567');

  res = parseCommand('removetrack dl 2982778275', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'remove_track');
  assert.strictEqual(res.payload.appNo, '2982778275');

  // 10. NEW Daily Filling commands mapped to normalizer
  // dlrenewal standard missing DOB -> error with dob required
  res = parseCommand('dlrenewal 2982778275', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  // dlrenewal correct format
  res = parseCommand('dlrenewal 2982778275 01-02-2003 MH26', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'dl_renewal_start');
  assert.strictEqual(res.payload.dlNo, '2982778275');
  assert.strictEqual(res.payload.dob, '01-02-2003');
  assert.strictEqual(res.payload.rtoCode, 'MH26');

  // dlapp correct format
  res = parseCommand('dlapp 2982778275 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'apply_dl_start');
  assert.strictEqual(res.payload.llNo, '2982778275');
  assert.strictEqual(res.payload.dob, '01-02-2003');

  // payfee missing DOB -> error
  res = parseCommand('payfee 2982778275', false, null, true);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  // 11. Accidental RC qualifier validation with DL inputs vs true RC application numbers
  // MH260507V1745659 has a V in the middle, so it is a true RC application number.
  // It should be successfully processed as an RC track without requiring DOB!
  res = parseCommand('track add rc MH260507V1745659', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'add_track_rc');
  assert.strictEqual(res.payload.appNo, 'MH260507V1745659');

  res = parseCommand('track add rc MH260507V1745659 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'add_track_rc');
  assert.strictEqual(res.payload.appNo, 'MH260507V1745659');

  res = parseCommand('addtrack rc MH260507V1745659 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'add_track_rc');
  assert.strictEqual(res.payload.appNo, 'MH260507V1745659');

  res = parseCommand('track rc MH260507V1745659', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track_rc');
  assert.strictEqual(res.payload.appNo, 'MH260507V1745659');

  res = parseCommand('track rc MH260507V1745659 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track_rc');
  assert.strictEqual(res.payload.appNo, 'MH260507V1745659');

  // But if a true DL license number like DL1320180000000 is prefixed with rc,
  // it should shift to DL and require DOB!
  res = parseCommand('track add rc DL1320180000000', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  res = parseCommand('track add rc DL1320180000000 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'add_track');
  assert.strictEqual(res.payload.appNo, 'DL1320180000000');
  assert.strictEqual(res.payload.dob, '01-02-2003');

  res = parseCommand('track rc DL1320180000000', false, standardUser, false);
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes('जन्मतिथि'));

  res = parseCommand('track rc DL1320180000000 01-02-2003', false, standardUser, false);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.type, 'track');
  assert.strictEqual(res.payload.appNo, 'DL1320180000000');
  assert.strictEqual(res.payload.dob, '01-02-2003');

  console.log('PASS - Command Normalizer tests passed!');
}

testCommandNormalizer();
