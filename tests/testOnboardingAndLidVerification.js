const repo = require('../src/services/authorizationRepository');
const normalizer = require('../src/services/authorizationNormalizer');
const { consumeVerificationMessage, startVerification } = require('../src/services/waVerificationService');
const { isAuthorizedWhatsApp } = require('../src/services/authorizationService');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

console.log("Starting onboarding and verification tests...");

// Reset repository table state manually
repo.runSync('DELETE FROM auth_users');
repo.runSync('DELETE FROM auth_user_identities');
repo.runSync('DELETE FROM auth_verifications');
repo.runSync('DELETE FROM authorized_groups');

const targetPhone = '917715055466';

// 1. Verification start
const verif = startVerification(targetPhone, 'admin', 'wa');
assert(verif && verif.code, "Token must be created successfully");
console.log("Token generated:", verif.code);

// 2. User is unauthorized before linking
const idObjBefore = {
  from: '917715055466@lid',
  author: '917715055466@lid',
  participant: '',
  identities: ['917715055466@lid']
};
assert(!isAuthorizedWhatsApp({ from: '917715055466@lid' }), "User not authorized before linking");

// 3. User verifies with valid token
const msgText = `AUTH ${targetPhone} ${verif.code}`;
const ok = consumeVerificationMessage(msgText, idObjBefore);
assert(ok, "Verification must succeed with correct token");

// 4. User is authorized after linking
assert(isAuthorizedWhatsApp({ from: '917715055466@lid' }), "User now authorized because identity is linked");

// 5. User removes access
const removed = repo.deactivateUser(targetPhone);
assert(removed, "User removed successfully");
assert(!isAuthorizedWhatsApp({ from: '917715055466@lid' }), "User not authorized after removal");

console.log("All onboarding tests passed successfully!");
