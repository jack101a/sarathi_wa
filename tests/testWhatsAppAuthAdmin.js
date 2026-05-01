const { handleAuthCommand } = require('../src/commands/authAdmin');
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

// 1. Check help command
const helpResult = handleAuthCommand('auth help');
assert(helpResult.includes('Available auth commands:'), "Should display available commands");

// 2. Check list command
const listResult = handleAuthCommand('auth list');
assert(listResult.includes('Authorized Entities:'), "Should print Authorized Entities");

// 3. Add entries via auth command
const addWaUserResult = handleAuthCommand('auth add wa user 919999999999');
assert(addWaUserResult === 'Successfully added 919999999999 to wa user access list.', "Success msg correct");

const addWaGroupResult = handleAuthCommand('auth add wa group 123456@g.us');
assert(addWaGroupResult === 'Successfully added 123456@g.us to wa group access list.', "Success msg correct");

const secondListResult = handleAuthCommand('auth list');
assert(secondListResult.includes('919999999999'), "Should contain added user");
assert(secondListResult.includes('123456@g.us'), "Should contain added group");

// 4. Remove entries via auth command
const removeResult = handleAuthCommand('auth remove wa user 919999999999');
assert(removeResult.includes('Successfully removed'), "Should confirm removal");

const thirdListResult = handleAuthCommand('auth list');
assert(!thirdListResult.includes('919999999999'), "Should not contain removed user");

console.log("WhatsApp Auth admin command tests passed successfully!");
