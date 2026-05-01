const { handleAuthCommand } = require('../../src/commands/authAdmin');
const { writeStore } = require('../../src/services/authorizationStore');
const {
  isAuthorizedWhatsApp,
  isAuthorizedTelegram
} = require('../../src/services/authorizationService');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

console.log("=== SIMULATING MANUAL CHECKS ===");

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
    AUTHORIZED_USERS: [],
    AUTHORIZED_GROUPS: [],
    AUTHORIZED_TG_USERS: [],
    AUTHORIZED_TG_GROUPS: [],
    ADMIN_USERS: []
  }
};

// 1. Admin sends 'auth list'
const listOutput = handleAuthCommand('auth list');
console.log("-> Sent 'auth list':\n", listOutput);

// 2. Add a new WA user
const addWaUserOutput = handleAuthCommand('auth add wa user 919999999999');
console.log("\n-> Sent 'auth add wa user 919999999999':\n", addWaUserOutput);

// Verify user can run commands
const isUserAllowedNow = isAuthorizedWhatsApp({ from: '919999999999@c.us' }, mockConfig);
console.log("-> WA user allowed now?", isUserAllowedNow);
assert(isUserAllowedNow, "WA user must be authorized now");

// 3. Remove same WA user
const removeWaUserOutput = handleAuthCommand('auth remove wa user 919999999999');
console.log("\n-> Sent 'auth remove wa user 919999999999':\n", removeWaUserOutput);

// Verify access denied
const isUserDeniedNow = !isAuthorizedWhatsApp({ from: '919999999999@c.us' }, mockConfig);
console.log("-> WA user denied now?", isUserDeniedNow);
assert(isUserDeniedNow, "WA user must be denied after removal");

// 4. Repeat same flow for Telegram
const addTgUserOutput = handleAuthCommand('auth add tg user 12345');
console.log("\n-> Sent 'auth add tg user 12345':\n", addTgUserOutput);

const isTgUserAllowed = isAuthorizedTelegram({ chat: { id: 12345, type: 'private' } }, mockConfig);
console.log("-> TG user allowed now?", isTgUserAllowed);
assert(isTgUserAllowed, "TG user must be authorized now");

const removeTgUserOutput = handleAuthCommand('auth remove tg user 12345');
console.log("\n-> Sent 'auth remove tg user 12345':\n", removeTgUserOutput);

const isTgUserDenied = !isAuthorizedTelegram({ chat: { id: 12345, type: 'private' } }, mockConfig);
console.log("-> TG user denied now?", isTgUserDenied);
assert(isTgUserDenied, "TG user must be denied after removal");

console.log("\nAll manual checks simulated successfully!");
