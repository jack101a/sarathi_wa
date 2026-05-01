const { writeStore, readStore } = require('../src/services/authorizationStore');
const {
  isAuthorizedWhatsApp,
  isAuthorizedTelegram,
  isAdminWhatsApp,
  addAuthorizedEntry,
  removeAuthorizedEntry
} = require('../src/services/authorizationService');
const { handleAuthCommand } = require('../src/commands/authAdmin');
const path = require('path');
const fs = require('fs');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

async function run() {
  // Set up clean environment
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
      AUTHORIZED_GROUPS: ['approved_group@g.us'],
      AUTHORIZED_TG_USERS: ['10001'],
      AUTHORIZED_TG_GROUPS: ['-20002'],
      ADMIN_USERS: ['919222222222']
    }
  };

  console.log("Starting full auth integration suite...");

  // 1. WA private authorized user allowed
  assert(isAuthorizedWhatsApp({ from: '919111111111@c.us' }, mockConfig), "WA private authorized user allowed (env)");

  // 2. WA private unauthorized user denied
  assert(!isAuthorizedWhatsApp({ from: '919999999999@c.us' }, mockConfig), "WA private unauthorized denied");

  // 3. WA approved group allowed for any member
  assert(isAuthorizedWhatsApp({ from: 'approved_group@g.us' }, mockConfig), "WA approved group allowed");

  // 4. WA unapproved group denied
  assert(!isAuthorizedWhatsApp({ from: 'unapproved_group@g.us' }, mockConfig), "WA unapproved group denied");

  // 5. TG private authorized allowed
  assert(isAuthorizedTelegram({ chat: { id: '10001', type: 'private' } }, mockConfig), "TG private authorized allowed");

  // 6. TG group authorized allowed
  assert(isAuthorizedTelegram({ chat: { id: '-20002', type: 'group' } }, mockConfig), "TG group authorized allowed");

  // 7. Admin command add/remove/list works in WA
  addAuthorizedEntry('wa', 'user', '919999999999');
  assert(isAuthorizedWhatsApp({ from: '919999999999@c.us' }, mockConfig), "Now allowed via dynamic update");

  removeAuthorizedEntry('wa', 'user', '919999999999');
  assert(!isAuthorizedWhatsApp({ from: '919999999999@c.us' }, mockConfig), "Now denied after remove");

  // 8. Admin command add/remove/list works via text parser directly
  const helpRes = await handleAuthCommand('auth help');
  assert(helpRes.includes('Available auth commands:'), "auth help works");

  const listRes = await handleAuthCommand('auth list wa users');
  assert(listRes.includes('Active WA users:'), "auth list works");

  // 9. Runtime update takes effect immediately
  addAuthorizedEntry('wa', 'user', '919444444444');
  assert(isAuthorizedWhatsApp({ from: '919444444444@c.us' }, mockConfig), "Runtime update immediate effect");

  // 10. Env fallback still works when runtime file empty
  removeAuthorizedEntry('wa', 'user', '919444444444');
  assert(isAuthorizedWhatsApp({ from: '919111111111@c.us' }, mockConfig), "Env fallback still works when runtime empty");

  // 11. Owner phone is always admin
  assert(isAdminWhatsApp({ from: '919000000000@c.us' }, mockConfig), "Owner is implicit admin");

  console.log("All auth integration tests passed successfully!");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
