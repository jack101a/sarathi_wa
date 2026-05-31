const assert = require('assert');
require('dotenv').config({ path: 'c:/codex/Antigravity/sarathi_wabot_lastest/.env' });

// 1. Spy on WhatsApp text notifier to capture output
const chatNotifier = require('../src/services/chatNotifier');
let capturedText = '';
chatNotifier.sendWhatsAppText = async (chatId, text) => {
  capturedText = text;
  return { ok: true };
};

// 2. Require apiWorker to load and register the handlers
require('../src/workers/apiWorker');

// 3. Retrieve the registered handler
const { apiQueue } = require('../src/core/jobQueue');

async function testWhatsAppIntegration() {
  console.log('🧪 Starting WhatsApp-POV Multi-Track Integration Test...');

  const handler = apiQueue.handler;
  assert.ok(handler, 'Worker handler must be registered');

  // We test with 2 application numbers (to run quickly)
  const job = {
    command: 'track_multiple',
    payload_json: JSON.stringify({ appNos: ['842305226', '842513926'] }),
    chat_id: '120363023242@g.us', // Simulated WhatsApp Group ID
    transport: 'whatsapp',
    user_phone: '919876543210',
    user_id: 'user_prem_111'
  };

  console.log('⏳ Simulating background execution of track_multiple job...');
  const result = await handler(job);

  assert.strictEqual(result.ok, true, 'Job completion should be successful');
  assert.ok(capturedText, 'Output text should be successfully sent via WhatsApp');
  assert.ok(capturedText.includes('*Application:* 842305226'), 'Response must contain details for application 1');
  assert.ok(capturedText.includes('*Application:* 842513926'), 'Response must contain details for application 2');

  console.log('\n========================================');
  console.log('📱 CAPTURED WHATSAPP RESPONSE POV:');
  console.log(capturedText);
  console.log('========================================\n');

  console.log('🎉 PASS - WhatsApp-POV integration test completed successfully!');
}

testWhatsAppIntegration().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
