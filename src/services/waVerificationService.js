const repo = require('./authorizationRepository');
const { normalizePhone } = require('./authorizationNormalizer');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function startVerification(phone, actor = 'admin', viaChannel = 'wa') {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return repo.createVerification(digits, generateCode(), actor, viaChannel);
}

async function resendVerification(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const existing = await repo.query('SELECT * FROM auth_verifications WHERE canonical_phone = ? AND status = "pending"', [digits]);
  for (const r of existing) await repo.updateVerificationStatus(r.id, 'cancelled', '');
  return repo.createVerification(digits, generateCode(), 'admin', 'wa');
}

async function cancelVerification(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return false;
  const existing = await repo.query('SELECT * FROM auth_verifications WHERE canonical_phone = ? AND status = "pending"', [digits]);
  if (!existing.length) return false;
  for (const r of existing) await repo.updateVerificationStatus(r.id, 'cancelled', '');
  return true;
}

async function getStatus(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const rows = await repo.query('SELECT * FROM auth_verifications WHERE canonical_phone = ? ORDER BY expires_at DESC LIMIT 1', [digits]);
  return rows[0] || null;
}

async function consumeVerificationMessage(messageText, identityContext) {
  if (!messageText || !identityContext) return false;
  const parts = String(messageText).trim().split(/\s+/);
  if (parts[0] && parts[0].toUpperCase() !== 'AUTH') return false;
  const phone = normalizePhone(parts[1] || '');
  const code = String(parts[2] || '').trim().toUpperCase();
  if (!phone || !code) return false;

  const verif = await repo.getPendingVerification(phone, code);
  if (!verif) return false;
  await repo.updateVerificationStatus(verif.id, 'verified', identityContext.from);
  const user = await repo.createUser(phone, 'wa');
  const identities = [...new Set(identityContext.identities || [])];
  for (const val of identities) {
    const exists = await repo.getIdentity(val);
    if (!exists) {
      let type = 'wa_cus';
      if (val.endsWith('@lid')) type = 'wa_lid';
      else if (val.endsWith('@g.us')) type = 'wa_other';
      await repo.createUserIdentity(user.id, type, val);
    }
  }

  // Always ensure the canonical @c.us alias is saved (91+10digit@c.us template)
  // This guarantees the bot can always recognize the user by phone even if WhatsApp
  // only provided the random @lid alias during registration.
  const canonicalCus = `91${phone}@c.us`;
  const cusExists = await repo.getIdentity(canonicalCus);
  if (!cusExists) {
    await repo.createUserIdentity(user.id, 'wa_cus', canonicalCus);
  }

  return true;
}

module.exports = { startVerification, resendVerification, cancelVerification, getStatus, consumeVerificationMessage };
