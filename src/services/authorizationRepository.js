const { execSync } = require('child_process');
const path = require('path');

function querySync(sql, params = []) {
  try {
    const helperPath = path.resolve(__dirname, 'authzHelper.js');
    const out = execSync(`node "${helperPath}" query`, {
      input: JSON.stringify({ sql, params }),
      encoding: 'utf8'
    });
    return JSON.parse(out.trim() || '[]');
  } catch (err) {
    return [];
  }
}

function runSync(sql, params = []) {
  try {
    const helperPath = path.resolve(__dirname, 'authzHelper.js');
    execSync(`node "${helperPath}" run`, {
      input: JSON.stringify({ sql, params }),
      encoding: 'utf8'
    });
    return true;
  } catch (err) {
    return false;
  }
}

function initDb() {
  try {
    const helperPath = path.resolve(__dirname, 'authzHelper.js');
    execSync(`node "${helperPath}" init`, { encoding: 'utf8' });

    // Migrate any legacy users from config
    const CONFIG = require('../config/config');
    const users = (CONFIG.SECURITY && CONFIG.SECURITY.AUTHORIZED_USERS) || [];
    for (const phone of users) {
      const digits = String(phone).trim().replace(/\D/g, '');
      if (digits) {
        // Query to check if the user already exists in DB
        const existing = querySync('SELECT * FROM auth_users WHERE canonical_phone = ?', [digits]);
        if (!existing.length) {
          const id = `user_migrated_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          const now = new Date().toISOString();
          runSync(
            'INSERT INTO auth_users (id, channel, canonical_phone, is_active, created_at, updated_at) VALUES (?, "wa", ?, 1, ?, ?)',
            [id, digits, now, now]
          );
          const identId = `ident_migrated_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          runSync(
            'INSERT INTO auth_user_identities (id, auth_user_id, identity_type, identity_value, verified_at, last_seen_at, is_active) VALUES (?, ?, "wa_cus", ?, ?, ?, 1)',
            [identId, id, digits + '@c.us', now, now]
          );
        }
      }
    }

    return true;
  } catch (err) {
    return false;
  }
}

// Ensure db init runs when this file is loaded
initDb();

// High level functions
function getUserByPhone(phone) {
  const rows = querySync('SELECT * FROM auth_users WHERE canonical_phone = ? AND is_active = 1', [phone]);
  return rows[0] || null;
}

function createUser(phone, channel = 'wa') {
  const existing = getUserByPhone(phone);
  if (existing) return existing;

  const id = `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();
  runSync(
    'INSERT OR REPLACE INTO auth_users (id, channel, canonical_phone, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    [id, channel, phone, now, now]
  );
  return { id, channel, canonical_phone: phone, is_active: 1, created_at: now, updated_at: now };
}

function deactivateUser(phone) {
  const user = getUserByPhone(phone);
  if (!user) return false;

  runSync('UPDATE auth_users SET is_active = 0 WHERE canonical_phone = ?', [phone]);
  runSync('UPDATE auth_user_identities SET is_active = 0 WHERE auth_user_id = ?', [user.id]);
  return true;
}

function createUserIdentity(userId, type, value) {
  const id = `ident_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();
  runSync(
    'INSERT OR REPLACE INTO auth_user_identities (id, auth_user_id, identity_type, identity_value, verified_at, last_seen_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [id, userId, type, value, now, now]
  );
  return { id, auth_user_id: userId, identity_type: type, identity_value: value, verified_at: now, last_seen_at: now, is_active: 1 };
}

function getIdentity(value) {
  const rows = querySync('SELECT * FROM auth_user_identities WHERE identity_value = ? AND is_active = 1', [value]);
  return rows[0] || null;
}

function createVerification(phone, code, requestedBy, requestedVia = 'wa') {
  const id = `verif_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins
  runSync(
    'INSERT INTO auth_verifications (id, channel, canonical_phone, code, status, requested_by, requested_via, expires_at, verified_at, verified_identity, meta_json) VALUES (?, "wa", ?, ?, "pending", ?, ?, ?, NULL, NULL, "{}")',
    [id, phone, code, requestedBy, requestedVia, expiresAt]
  );
  return { id, channel: 'wa', canonical_phone: phone, code, status: 'pending', requested_by: requestedBy, requested_via: requestedVia, expires_at: expiresAt };
}

function getPendingVerification(phone, code) {
  const rows = querySync(
    'SELECT * FROM auth_verifications WHERE canonical_phone = ? AND code = ? AND status = "pending" AND expires_at > ?',
    [phone, code, new Date().toISOString()]
  );
  return rows[0] || null;
}

function updateVerificationStatus(id, status, verifiedIdentity) {
  const now = new Date().toISOString();
  runSync(
    'UPDATE auth_verifications SET status = ?, verified_at = ?, verified_identity = ? WHERE id = ?',
    [status, now, verifiedIdentity, id]
  );
}

function getAuthorizedGroups(channel) {
  return querySync('SELECT * FROM authorized_groups WHERE channel = ? AND is_active = 1', [channel]);
}

function addAuthorizedGroup(groupId, channel, createdBy = 'admin') {
  const id = `group_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const now = new Date().toISOString();
  runSync(
    'INSERT OR REPLACE INTO authorized_groups (id, channel, group_id, is_active, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?)',
    [id, channel, groupId, createdBy, now]
  );
  return { id, channel, group_id: groupId, is_active: 1, created_by: createdBy, created_at: now };
}

function removeAuthorizedGroup(groupId, channel) {
  runSync('UPDATE authorized_groups SET is_active = 0 WHERE group_id = ? AND channel = ?', [groupId, channel]);
}

module.exports = {
  initDb,
  querySync,
  runSync,
  getUserByPhone,
  createUser,
  deactivateUser,
  createUserIdentity,
  getIdentity,
  createVerification,
  getPendingVerification,
  updateVerificationStatus,
  getAuthorizedGroups,
  addAuthorizedGroup,
  removeAuthorizedGroup
};
