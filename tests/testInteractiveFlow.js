const assert = require('assert');
const { initDb } = require('../src/services/authorizationRepository');
const { detectAndHandle } = require('../src/services/interactiveFlowService');

async function runTests() {
  console.log('🔄 Initializing database for interactive flow tests...');
  await initDb();

  const chatId = 'test_chat_interactive_123';

  // Mock users
  const adminUser = {
    id: 'user_admin_111',
    subscription_plan: 'premium',
    rate_limit_overrides: '{}'
  };

  const premiumUser = {
    id: 'user_prem_222',
    subscription_plan: 'premium',
    rate_limit_overrides: '{}'
  };

  const freeUser = {
    id: 'user_free_333',
    subscription_plan: 'free',
    rate_limit_overrides: JSON.stringify({
      services: ['track', 'fee_print_start', 'llprint_start']
    })
  };

  const regularUserWithLlAccess = {
    id: 'user_regular_444',
    subscription_plan: 'free',
    rate_limit_overrides: JSON.stringify({
      services: ['apply_dl_start', 'track', 'fee_print_start', 'llprint_start']
    })
  };

  console.log('🧪 Starting Interactive Flow test cases...');

  // 1. DL Interactive flow start
  let res = await detectAndHandle(chatId, 'dl MH47/0050138/2026 02-01-2002', freeUser, false);
  assert.strictEqual(res.handled, true);
  assert.ok(res.replyText.includes('Choose a Driving Licence service'));
  
  // Test choice resolution for DL
  res = await detectAndHandle(chatId, '3', freeUser, false);
  assert.strictEqual(res.handled, true);
  assert.strictEqual(res.executeCommand, 'renewal MH47/0050138/2026 02-01-2002');

  // 2. LL Interactive flow start (Admin - should show LL Edit and Apply New DL)
  res = await detectAndHandle(chatId, 'll MH47/0050138/2026 02-01-2002', adminUser, true);
  assert.strictEqual(res.handled, true);
  assert.ok(res.replyText.includes('Choose a Learner Licence service'));
  assert.ok(res.replyText.includes('LL Edit'));
  assert.ok(res.replyText.includes('Apply New DL'));
  
  // Test Choice 1 for Admin LL (should be LL Edit)
  res = await detectAndHandle(chatId, '1', adminUser, true);
  assert.strictEqual(res.handled, true);
  assert.strictEqual(res.executeCommand, 'lledit MH47/0050138/2026 02-01-2002');

  // 3. LL Interactive flow start (Regular User - should only show Apply New DL)
  res = await detectAndHandle(chatId, 'll MH47/0050138/2026 02-01-2002', regularUserWithLlAccess, false);
  assert.strictEqual(res.handled, true);
  assert.ok(res.replyText.includes('Choose a Learner Licence service'));
  assert.ok(!res.replyText.includes('LL Edit'));
  assert.ok(res.replyText.includes('Apply New DL'));
  
  // Test Choice 1 for Regular LL (should map to Apply New DL / dlapp)
  res = await detectAndHandle(chatId, '1', regularUserWithLlAccess, false);
  assert.strictEqual(res.handled, true);
  assert.strictEqual(res.executeCommand, 'dlapp MH47/0050138/2026 02-01-2002');

  // 4. Application Interactive flow start (Admin - should show all 10 options grouped and spaced)
  res = await detectAndHandle(chatId, '236630024 05-08-1994', adminUser, true);
  assert.strictEqual(res.handled, true);
  assert.ok(res.replyText.includes('Choose an Application service'));
  assert.ok(res.replyText.includes('Track Application Status'));
  assert.ok(res.replyText.includes('Acknowledgement Receipt'));
  assert.ok(res.replyText.includes('Formset (Combined PDF)'));
  assert.ok(res.replyText.includes('Print Fee Receipt'));
  assert.ok(res.replyText.includes('Slot Booking Receipt'));
  assert.ok(res.replyText.includes('LL Print'));
  assert.ok(res.replyText.includes('Resend LL Password'));
  
  // Verify correct group spacing gaps
  const newlineCount = (res.replyText.match(/\n\n/g) || []).length;
  assert.ok(newlineCount >= 3, 'Menu should have at least 3 group separation line gaps');

  // Test Choice 10 resolution for Admin (Resend LL Password)
  res = await detectAndHandle(chatId, '10', adminUser, true);
  assert.strictEqual(res.handled, true);
  assert.strictEqual(res.executeCommand, undefined);
  assert.deepStrictEqual(res.executeCommands, ['resend 236630024 05-08-1994']);

  // 5. Multiple choice execution for Premium User
  res = await detectAndHandle(chatId, '236630024 05-08-1994', premiumUser, false);
  assert.strictEqual(res.handled, true);
  
  // Select multiple options (Acknowledgement Receipt, Form 1, Formset)
  res = await detectAndHandle(chatId, '2, 3, 6', premiumUser, false);
  assert.strictEqual(res.handled, true);
  assert.deepStrictEqual(res.executeCommands, [
    'app 236630024 05-08-1994',
    'form1 236630024 05-08-1994',
    'formset 236630024 05-08-1994'
  ]);

  // 6. Multiple choice block for Free User
  res = await detectAndHandle(chatId, '236630024 05-08-1994', freeUser, false);
  assert.strictEqual(res.handled, true);
  
  res = await detectAndHandle(chatId, '2, 3', freeUser, false);
  assert.strictEqual(res.handled, true);
  assert.ok(res.replyText.includes('Multiple option selection is only available for Premium plan users'));

  // 7. Dynamic consecutive numbering verification for Free User
  res = await detectAndHandle(chatId, '236630024 05-08-1994', freeUser, false);
  assert.strictEqual(res.handled, true);
  
  // Free tier has track, fees, and llprint allowed by default seed
  // The menu should show exactly those 3 options sequentially numbered 1 to 3
  assert.ok(res.replyText.includes('1. Track Application Status'));
  assert.ok(res.replyText.includes('2. Print Fee Receipt'));
  assert.ok(res.replyText.includes('3. LL Print'));
  assert.ok(!res.replyText.includes('4.')); // Should NOT contain a 4th option

  // Test Choice 2 for Free user (should resolve to fees receipt)
  res = await detectAndHandle(chatId, '2', freeUser, false);
  assert.strictEqual(res.handled, true);
  assert.deepStrictEqual(res.executeCommands, ['fees 236630024 05-08-1994']);

  // 8. Command Bypasses (direct command keyword should be ignored by interactive flow)
  res = await detectAndHandle(chatId, 'dl renewal MH47/0050138/2026 02-01-2002', freeUser, false);
  assert.strictEqual(res.handled, false);

  res = await detectAndHandle(chatId, 'alive', freeUser, false);
  assert.strictEqual(res.handled, false);

  console.log('🎉 PASS - All interactive flow and dynamic permissions tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
