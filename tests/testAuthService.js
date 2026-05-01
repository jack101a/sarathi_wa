const {
  isAuthorizedWhatsApp,
  isAuthorizedTelegram,
  isAdminWhatsApp,
  isAdminTelegram,
  addAuthorizedEntry,
  removeAuthorizedEntry,
  listAuthorizedEntries
} = require('../src/services/authorizationService');
const { writeStore } = require('../src/services/authorizationStore');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// Reset store
writeStore({
  version: 1,
  whatsapp: { users: [], groups: [], admins: [] },
  telegram: { users: [], groups: [], admins: [] },
  updatedAt: new Date().toISOString()
});

const mockConfig = {
  WHATSAPP: { PHONE_NUMBER: '919000000000' },
  SECURITY: {
    AUTHORIZED_USERS: ['919111111111'],
    AUTHORIZED_GROUPS: ['group1@g.us'],
    AUTHORIZED_TG_USERS: ['10001'],
    AUTHORIZED_TG_GROUPS: ['-20002'],
    ADMIN_USERS: ['919222222222']
  }
};

// Test WhatsApp Authorization
// 1. WhatsApp owner should be implicit admin & authorized
const waMsgOwner = { from: '919000000000@c.us' };
assert(isAdminWhatsApp(waMsgOwner, mockConfig), "Owner should be admin");
assert(isAuthorizedWhatsApp(waMsgOwner, mockConfig), "Owner should be authorized");

// 2. Env fallback users authorized
const waMsgEnvUser = { from: '919111111111@c.us' };
assert(isAuthorizedWhatsApp(waMsgEnvUser, mockConfig), "Env user should be authorized");

// 3. Env fallback groups authorized
const waMsgEnvGroup = { from: 'group1@g.us' };
assert(isAuthorizedWhatsApp(waMsgEnvGroup, mockConfig), "Env group should be authorized");

// 4. Unknown user not authorized initially
const waMsgNewUser = { from: '919333333333@c.us' };
assert(!isAuthorizedWhatsApp(waMsgNewUser, mockConfig), "New user should NOT be authorized initially");

// 5. Add user via service mutation
addAuthorizedEntry('wa', 'user', '919333333333');
assert(isAuthorizedWhatsApp(waMsgNewUser, mockConfig), "New user should be authorized after adding to dynamic store");

// 6. Remove user via service mutation
removeAuthorizedEntry('wa', 'user', '919333333333');
assert(!isAuthorizedWhatsApp(waMsgNewUser, mockConfig), "New user should NOT be authorized after removal");

// 7. Add group via service mutation
const waMsgNewGroup = { from: 'group2@g.us' };
assert(!isAuthorizedWhatsApp(waMsgNewGroup, mockConfig), "New group should NOT be authorized initially");
addAuthorizedEntry('whatsapp', 'group', 'group2@g.us');
assert(isAuthorizedWhatsApp(waMsgNewGroup, mockConfig), "New group should be authorized after adding");
removeAuthorizedEntry('whatsapp', 'group', 'group2@g.us');
assert(!isAuthorizedWhatsApp(waMsgNewGroup, mockConfig), "New group should NOT be authorized after removal");

// Test Telegram Authorization
const tgMsgOwner = { chat: { id: 10001, type: 'private' } };
assert(isAuthorizedTelegram(tgMsgOwner, mockConfig), "Telegram user in env config should be authorized");

// Add tg user
const tgMsgNewUser = { chat: { id: 10002, type: 'private' } };
assert(!isAuthorizedTelegram(tgMsgNewUser, mockConfig), "New Telegram user should not be authorized initially");
addAuthorizedEntry('tg', 'user', '10002');
assert(isAuthorizedTelegram(tgMsgNewUser, mockConfig), "New Telegram user should be authorized after adding");
removeAuthorizedEntry('tg', 'user', '10002');
assert(!isAuthorizedTelegram(tgMsgNewUser, mockConfig), "New Telegram user should not be authorized after removal");

console.log("All authorization service tests passed successfully!");
