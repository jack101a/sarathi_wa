const assert = require('assert');
const { isAuthorized, getWhatsAppSenderId, isAdminUser } = require('../src/core/auth');

function run() {
  const config = {
    SECURITY: {
      AUTHORIZED_USERS: ['919660930674', '917715055466'],
      AUTHORIZED_GROUPS: [],
      ADMIN_USERS: ['917715055466'],
    },
    WHATSAPP: {
      PHONE_NUMBER: '917715055466'
    }
  };

  // 1. Check direct match
  assert.strictEqual(isAuthorized({ from: '919660930674@c.us' }, config), true);
  
  // 2. Check linked device match (device index suffix)
  assert.strictEqual(isAuthorized({ from: '919660930674:1@c.us' }, config), true);
  assert.strictEqual(isAuthorized({ from: '917715055466:22@c.us' }, config), true);

  // 3. Check unauthorized
  assert.strictEqual(isAuthorized({ from: '911111111111@c.us' }, config), false);

  // 4. Check sender ID extraction
  assert.strictEqual(getWhatsAppSenderId({ from: '919660930674:1@c.us' }), '919660930674');
  assert.strictEqual(getWhatsAppSenderId({ from: '917715055466@c.us' }), '917715055466');

  // 5. Check admin user validation
  assert.strictEqual(isAdminUser({ from: '917715055466:10@c.us' }, config), true);
  assert.strictEqual(isAdminUser({ from: '919660930674@c.us' }, config), false);

  console.log('PASS - auth fix tests');
}

run();
