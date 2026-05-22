const repo = require('./authorizationRepository');
const { normalizePhone } = require('./authorizationNormalizer');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
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
  
  let phone = '';
  let code = '';
  let verif = null;

  const textClean = String(messageText).trim().toUpperCase();
  const parts = textClean.split(/\s+/);

  if (parts[0] === 'AUTH') {
    // Legacy format: AUTH <phone> <OTP>
    phone = normalizePhone(parts[1] || '');
    code = String(parts[2] || '').trim().toUpperCase();
    if (phone && code) {
      verif = await repo.getPendingVerification(phone, code);
    }
  } else if (textClean.length === 8 && /^[A-Z0-9]{8}$/.test(textClean)) {
    // Convenient format: just the 8-digit OTP code itself!
    code = textClean;
    const nowStr = new Date().toISOString();
    const rows = await repo.query('SELECT * FROM auth_verifications WHERE code = ? AND status = "pending" AND expires_at > ?', [code, nowStr]);
    if (rows && rows.length > 0) {
      verif = rows[0];
      phone = verif.canonical_phone;
    }
  }

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
  const canonicalCus = `91${phone}@c.us`;
  const cusExists = await repo.getIdentity(canonicalCus);
  if (!cusExists) {
    await repo.createUserIdentity(user.id, 'wa_cus', canonicalCus);
  }

  return true;
}

module.exports = { startVerification, resendVerification, cancelVerification, getStatus, consumeVerificationMessage };
