const path = require('path');
const fs = require('fs');
const { getStorePath, readStore, writeStore, normalizeStore } = require('../src/services/authorizationStore');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// Ensure clean start: delete store if exists
const storePath = getStorePath();
if (fs.existsSync(storePath)) {
  fs.unlinkSync(storePath);
}

// 1. Read when file missing (should seed file with default schema)
const firstRead = readStore();
assert(firstRead.version === 1, "Expected schema version 1");
assert(Array.isArray(firstRead.whatsapp.users), "Expected users array");
assert(fs.existsSync(storePath), "File should be created on first read");

// 2. Write something and normalize dedupe check
const testData = {
  version: 1,
  whatsapp: {
    users: [' 919999999999 ', '91-99999-99999', '919999999999'],
    groups: ['123456@g.us', '654321'],
    admins: ['+918888888888']
  },
  telegram: {
    users: [' 123456789 ', ' 123456789 '],
    groups: ['-987654321'],
    admins: ['55555']
  }
};

const written = writeStore(testData);

// Normalization checks
assert(written.whatsapp.users.length === 1, "Should dedupe identical normalized numbers");
assert(written.whatsapp.users[0] === '919999999999', "Should normalize phone to digits only");
assert(written.whatsapp.groups[1] === '654321@g.us', "Should normalize wa group to end with @g.us");
assert(written.whatsapp.admins[0] === '918888888888', "Should normalize wa admin to digits only");
assert(written.telegram.users.length === 1, "Should dedupe telegram user IDs");
assert(written.telegram.users[0] === '123456789', "Should normalize telegram user IDs");
assert(written.telegram.groups[0] === '-987654321', "Should keep negative sign on telegram group IDs");

// Survival over read/write
const secondRead = readStore();
assert(secondRead.whatsapp.users[0] === '919999999999', "Read should persist data");

console.log("All authorization store tests passed successfully!");
