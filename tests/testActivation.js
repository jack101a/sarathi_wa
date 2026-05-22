/**
 * Test script to verify the new 8-character OTP activation and identity linking workflow.
 */
require('dotenv').config();
const repo = require('../src/services/authorizationRepository');
const waVerificationService = require('../src/services/waVerificationService');
const { extractIdentityFromMessage } = require('../src/services/authorizationNormalizer');

async function runTest() {
  console.log("⚡ Starting Auth Verification & JID Mapping Test...");

  const testPhone = '9898989898';
  
  // 1. Clean up any existing test user / verifications to start fresh
  console.log("🧹 Cleaning up old test data...");
  await repo.run("DELETE FROM auth_users WHERE canonical_phone = ?", [testPhone]);
  await repo.run("DELETE FROM auth_verifications WHERE canonical_phone = ?", [testPhone]);
  
  // 2. Simulate User creation from Admin Panel
  console.log(`\n👤 [Admin UI] Creating user with phone: ${testPhone}...`);
  const user = await repo.createUser(testPhone, 'wa');
  console.log("✅ User created in DB:", user);

  // 3. Generate 8-character verification OTP (what happens in adminRouter)
  console.log("\n🔑 [Admin UI] Generating 8-digit OTP...");
  const verif = await waVerificationService.startVerification(testPhone, 'admin', 'wa');
  console.log("✅ Pending Verification entry created:");
  console.log(`   - ID: ${verif.id}`);
  console.log(`   - Phone: ${verif.canonical_phone}`);
  console.log(`   - Code: ${verif.code} (${verif.code.length} chars)`);
  console.log(`   - Status: ${verif.status}`);
  console.log(`   - Expires: ${verif.expires_at}`);

  // 4. Simulate User sending their 8-character activation OTP from their WhatsApp account
  // Let's simulate a user JID with a multi-device suffix and a new LID domain!
  const userLidJid = '1234567890abcdef@lid';
  const userJidWithDeviceSuffix = '1234567890abcdef:3@lid';
  const mockMessage = {
    from: userJidWithDeviceSuffix,
    body: verif.code.toLowerCase(), // Simulate user typing lowercase
    author: userJidWithDeviceSuffix
  };

  console.log(`\n📱 [Bot] Incoming message from JID: ${mockMessage.from} with body: "${mockMessage.body}"`);
  
  const textClean = String(mockMessage.body).trim().toUpperCase();
  const idContext = extractIdentityFromMessage(mockMessage);
  
  console.log("🔍 [Normalizer] Extracted Identity JIDs (stripped of multi-device suffixes):", idContext.identities);

  // 5. Consume verification code (exactly what happens in bot.js)
  console.log("\n⚙️ [Verification Service] Consuming activation message...");
  const success = await waVerificationService.consumeVerificationMessage(textClean, idContext);
  
  if (success) {
    console.log("🎉 SUCCESS: Account verified and linked!");
    
    // Check if the user's identities are linked in the database
    const dbUser = await repo.getUserByPhone(testPhone);
    const dbIdentities = await repo.query("SELECT * FROM auth_user_identities WHERE auth_user_id = ?", [dbUser.id]);
    
    console.log("\n📊 Linked Identities in Database:");
    dbIdentities.forEach(ident => {
      console.log(`   - [${ident.identity_type}]: ${ident.identity_value} (active: ${ident.is_active === 1 ? 'YES' : 'NO'})`);
    });

    // Check if the verification is updated
    const dbVerif = await repo.query("SELECT * FROM auth_verifications WHERE id = ?", [verif.id]);
    console.log(`\n📝 Verification status in DB: ${dbVerif[0].status} (Verified identity: ${dbVerif[0].verified_identity})`);

  } else {
    console.log("❌ FAILED: Verification failed!");
  }

  // Clean up
  console.log("\n🧹 Cleaning up test data...");
  await repo.run("DELETE FROM auth_users WHERE canonical_phone = ?", [testPhone]);
  await repo.run("DELETE FROM auth_verifications WHERE canonical_phone = ?", [testPhone]);
  console.log("👋 Done!");
  process.exit(0);
}

runTest().catch(err => {
  console.error("❌ Test crashed:", err);
  process.exit(1);
});
