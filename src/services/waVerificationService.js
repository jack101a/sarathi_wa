const repo = require('./authorizationRepository');
const { normalizePhone } = require('./authorizationNormalizer');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function startVerification(phone, actor = 'admin', viaChannel = 'wa') {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const code = generateCode();
  const verif = repo.createVerification(digits, code, actor, viaChannel);
  return verif;
}

function resendVerification(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  // Deactivate or cancel existing pending verifications for this phone
  const existing = repo.querySync('SELECT * FROM auth_verifications WHERE canonical_phone = ? AND status = "pending"', [digits]);
  for (const r of existing) {
    repo.updateVerificationStatus(r.id, 'cancelled', '');
  }

  const code = generateCode();
  const verif = repo.createVerification(digits, code, 'admin', 'wa');
  return verif;
}

function cancelVerification(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return false;

  const existing = repo.querySync('SELECT * FROM auth_verifications WHERE canonical_phone = ? AND status = "pending"', [digits]);
  if (!existing.length) return false;

  for (const r of existing) {
    repo.updateVerificationStatus(r.id, 'cancelled', '');
  }
  return true;
}

function getStatus(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const rows = repo.querySync('SELECT * FROM auth_verifications WHERE canonical_phone = ? ORDER BY expires_at DESC LIMIT 1', [digits]);
  return rows[0] || null;
}

function consumeVerificationMessage(messageText, identityContext) {
  if (!messageText || !identityContext) return false;

  // Match: AUTH <phone> <code>
  const parts = String(messageText).trim().split(/\s+/);
  if (parts[0] && parts[0].toUpperCase() !== 'AUTH') return false;

  const phone = normalizePhone(parts[1] || '');
  const code = String(parts[2] || '').trim().toUpperCase();

  if (!phone || !code) return false;

  const verif = repo.getPendingVerification(phone, code);
  if (!verif) return false;

  // Match success
  repo.updateVerificationStatus(verif.id, 'verified', identityContext.from);

  // Link user and identity
  const user = repo.createUser(phone, 'wa');
  const identities = [...new Set(identityContext.identities || [])];
  for (const val of identities) {
    // Only link if not already bound
    const exists = repo.getIdentity(val);
    if (!exists) {
      let type = 'wa_cus';
      if (val.endsWith('@lid')) type = 'wa_lid';
      else if (val.endsWith('@g.us')) type = 'wa_other';
      repo.createUserIdentity(user.id, type, val);
    }
  }

  return true;
}

module.exports = {
  startVerification,
  resendVerification,
  cancelVerification,
  getStatus,
  consumeVerificationMessage
};
