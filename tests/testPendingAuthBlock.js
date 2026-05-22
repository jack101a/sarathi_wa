/**
 * Unit test to verify that users with active pending verifications are blocked from
 * using bot features until they verify.
 */
require('dotenv').config();
const repo = require('../src/services/authorizationRepository');
const authService = require('../src/services/authorizationService');
const waVerificationService = require('../src/services/waVerificationService');

async function runTest() {
  console.log("⚡ Starting Pending Verification Block Test...");
  const testPhone = '9797979797';
  
  // Clean up
  await repo.run("DELETE FROM auth_users WHERE canonical_phone = ?", [testPhone]);
  await repo.run("DELETE FROM auth_verifications WHERE canonical_phone = ?", [testPhone]);
  await repo.run("DELETE FROM auth_user_identities WHERE auth_user_id IN (SELECT id FROM auth_users WHERE canonical_phone = ?)", [testPhone]);

  // 1. Create a user via addAuthorizedEntry (simulates admin adding a user)
  console.log("\n👤 Adding user via addAuthorizedEntry...");
  const user = await authService.addAuthorizedEntry('wa', 'user', testPhone, { name: 'Test Pending User' });
  console.log("✅ User created:", user);

  // Verify that the user has NO identities pre-registered (our new change!)
  const identities = await repo.query("SELECT * FROM auth_user_identities WHERE auth_user_id = ?", [user.id]);
  console.log("📊 Pre-registered identities count:", identities.length);
  if (identities.length > 0) {
    console.error("❌ FAILED: Standard JIDs were pre-registered when they shouldn't be!");
    process.exit(1);
  } else {
    console.log("✅ SUCCESS: No JID identities were pre-registered automatically.");
  }

  // 2. Check authorization before generating OTP verification
  // Since there's no pending verification yet, fallback check allows them
  const mockMsg = {
    from: `${testPhone}@c.us`,
    body: 'hello'
  };
  let isAllowed = await authService.isAuthorizedWhatsApp(mockMsg);
  console.log(`\n🔒 Authorization check BEFORE generating pending OTP (should be true): ${isAllowed}`);
  if (!isAllowed) {
    console.error("❌ FAILED: Normal user with no pending verifications should be allowed.");
    process.exit(1);
  }

  // 3. Generate a pending OTP verification (happens during dashboard user creation)
  console.log("\n🔑 Generating pending verification OTP...");
  const verif = await waVerificationService.startVerification(testPhone, 'admin', 'wa');
  console.log(`✅ Pending OTP generated: ${verif.code}`);

  // 4. Check authorization now! (Should be BLOCKED because they have a pending verification!)
  isAllowed = await authService.isAuthorizedWhatsApp(mockMsg);
  console.log(`🔒 Authorization check AFTER generating pending OTP (should be FALSE): ${isAllowed}`);
  
  const matchedUser = await authService.getUserForRequest(mockMsg, 'whatsapp');
  console.log(`👤 User retrieved for request (should be null):`, matchedUser);

  if (isAllowed || matchedUser !== null) {
    console.error("❌ FAILED: User was authorized despite having a pending verification OTP!");
    process.exit(1);
  }
  console.log("✅ SUCCESS: User is correctly blocked while verification is pending.");

  // Clean up
  await repo.run("DELETE FROM auth_users WHERE canonical_phone = ?", [testPhone]);
  await repo.run("DELETE FROM auth_verifications WHERE canonical_phone = ?", [testPhone]);
  console.log("\n👋 Done!");
  process.exit(0);
}

runTest().catch(err => {
  console.error("❌ Test crashed:", err);
  process.exit(1);
});
