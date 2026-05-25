const assert = require('assert');
const { detectAndHandle } = require('../src/services/interactiveFlowService');

function testInteractiveFlow() {
  const chatId = 'test_chat_123';

  // 1. DL Interactive flow start
  let res = detectAndHandle(chatId, 'dl MH47/0050138/2026 02-01-2002');
  assert.strictEqual(res.handled, true);
  assert.ok(res.replyText.includes('Choose a Driving Licence service'));

  // 2. LL Interactive flow start
  res = detectAndHandle(chatId, 'll MH47/0050138/2026 02-01-2002');
  assert.strictEqual(res.handled, true);
  assert.ok(res.replyText.includes('Choose a Learner Licence service'));

  // 3. Application Interactive flow start (pure numeric, no command prefix)
  res = detectAndHandle(chatId, '236630024 05-08-1994');
  assert.strictEqual(res.handled, true);
  assert.ok(res.replyText.includes('Choose an Application service'));

  // 4. DL Renewal Command Bypass
  res = detectAndHandle(chatId, 'dl renewal MH47/0050138/2026 02-01-2002');
  assert.strictEqual(res.handled, false);

  // 5. Apply DL Command Bypass
  res = detectAndHandle(chatId, 'Applydl MH47 /0050138/2026 02-01-2002');
  assert.strictEqual(res.handled, false);

  res = detectAndHandle(chatId, 'dlapp MH47 /0050138/2026 02-01-2002');
  assert.strictEqual(res.handled, false);

  // 6. Form1 Command Bypass (letters in first word, shouldn't trigger App Menu)
  res = detectAndHandle(chatId, 'Form1 236630024 05-08-1994');
  assert.strictEqual(res.handled, false);

  // 7. Standard unhandled commands
  res = detectAndHandle(chatId, 'alive');
  assert.strictEqual(res.handled, false);

  console.log('PASS - Interactive Flow tests passed successfully!');
}

testInteractiveFlow();
