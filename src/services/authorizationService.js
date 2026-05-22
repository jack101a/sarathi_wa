const CONFIG = require('../config/config');
const repo = require('./authorizationRepository');
const { extractIdentityFromMessage, normalizePhone } = require('./authorizationNormalizer');

function getWhatsAppSenderId(message) {
  const fromId = String((message && message.from) || '').trim().toLowerCase();
  const authorId = String((message && message.author) || '').trim().toLowerCase();
  const baseId = fromId.endsWith('@g.us') ? (authorId || fromId) : (fromId || authorId);
  if (baseId.endsWith('@c.us')) return baseId.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (baseId.endsWith('@lid')) return baseId;
  return baseId;
}
function parseCsv(val) { return String(val || '').split(',').map((v) => v.trim()).filter(Boolean); }

function isAdminWhatsApp(message, config = CONFIG) {
  try {
    if (!message) return false;
    const senderId = getWhatsAppSenderId(message);
    const ownerPhone = String((config.WHATSAPP && config.WHATSAPP.PHONE_NUMBER) || '').trim().replace(/\D/g, '');
    if (ownerPhone && senderId === ownerPhone) return true;
    const admins = (config.SECURITY.ADMIN_USERS || []).map((u) => String(u).replace(/\D/g, ''));
    return admins.includes(senderId);
  } catch (_) { return false; }
}

async function isAuthorizedWhatsApp(message, config = CONFIG) {
  try {
    if (!message || !message.from) return false;
    if (isAdminWhatsApp(message, config)) return true;
    const senderId = message.from;
    if (senderId.endsWith('@g.us')) {
      const allowed = await repo.getAuthorizedGroups('wa');
      if (allowed.some((g) => g.group_id === senderId)) return true;
      return (config.SECURITY.AUTHORIZED_GROUPS || []).includes(senderId);
    }
    const idObj = extractIdentityFromMessage(message);
    if (idObj && idObj.identities) {
      for (const val of idObj.identities) {
        if (await repo.getIdentity(val)) return true;
      }
    }
    const pureSender = getWhatsAppSenderId(message);
    if (pureSender) {
      const user = await repo.getUserByPhone(pureSender);
      if (user && Number(user.is_active) === 1) return true;
      if (pureSender.length > 10) {
        const short10 = pureSender.slice(-10);
        const user10 = await repo.getUserByPhone(short10);
        if (user10 && Number(user10.is_active) === 1) return true;
      }
    }
    const envUsers = (config.SECURITY.AUTHORIZED_USERS || []).map((u) => String(u).replace(/\D/g, ''));
    if (envUsers.includes(pureSender)) return true;
    if (pureSender && pureSender.length > 10) {
      const short10 = pureSender.slice(-10);
      const envUsers10 = envUsers.map(u => u.length > 10 ? u.slice(-10) : u);
      if (envUsers10.includes(short10)) return true;
    }
    return false;
  } catch (_) { return false; }
}

function isAdminTelegram(msg, config = CONFIG) {
  try {
    if (!msg || !msg.chat || !msg.chat.id) return false;
    const chatId = String(msg.chat.id);
    const envTgAdmins = [...parseCsv(process.env.AUTHORIZED_TG_ADMINS || ''), ...(config.SECURITY.ADMIN_USERS || [])];
    return envTgAdmins.map(String).includes(chatId);
  } catch (_) { return false; }
}

async function isAuthorizedTelegram(msg, config = CONFIG) {
  try {
    if (!msg || !msg.chat || !msg.chat.id) return false;
    if (isAdminTelegram(msg, config)) return true;
    const chatId = String(msg.chat.id);
    if (msg.chat.type === 'private') {
      if (await repo.getUserByPhone(chatId)) return true;
      return (config.SECURITY.AUTHORIZED_TG_USERS || []).includes(chatId);
    }
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      const allowed = await repo.getAuthorizedGroups('tg');
      if (allowed.some((g) => g.group_id === chatId)) return true;
      return (config.SECURITY.AUTHORIZED_TG_GROUPS || []).includes(chatId);
    }
    return false;
  } catch (_) { return false; }
}

async function getUserForRequest(message, transport) {
  const t = String(transport || '').toLowerCase();
  if (t === 'telegram') {
    const chatId = String(message && message.chat && message.chat.id || '');
    return chatId ? repo.getUserByPhone(chatId) : null;
  }

  // Step 1: Try matching via auth_user_identities (alias table).
  // The identity_value stored on registration is like "9876543210@c.us" (10-digit).
  // But the sender JID may come as "919876543210@c.us" (with country code).
  // So we also try the last-10-digit variant of each identity to handle the mismatch.
  const idObj = extractIdentityFromMessage(message);
  if (idObj && idObj.identities) {
    for (const val of idObj.identities) {
      // Try exact match first
      let identity = await repo.getIdentity(val);
      // If no match and it's a JID, also try stripping to last 10 digits (only for phone-number domains)
      if (!identity && val.includes('@')) {
        const [localPart, domain] = val.split('@');
        if (domain === 'c.us' || domain === 's.whatsapp.net') {
          const digits = localPart.replace(/\D/g, '');
          const short = digits.length > 10 ? digits.slice(-10) : digits;
          if (short !== localPart) {
            identity = await repo.getIdentity(`${short}@${domain}`);
          }
        }
      }
      if (identity && identity.auth_user_id) {
        const user = await repo.getUserById(identity.auth_user_id);
        if (user && Number(user.is_active) === 1) return user;
      }
    }
  }

  // Step 2: Try canonical_phone direct match — full number first, then last-10.
  const phone = getWhatsAppSenderId(message); // already digits-only
  if (phone) {
    const user = await repo.getUserByPhone(phone);
    if (user && Number(user.is_active) === 1) return user;
    // Try last-10 variant in case DB stores without country code
    if (phone.length > 10) {
      const short10 = phone.slice(-10);
      const user10 = await repo.getUserByPhone(short10);
      if (user10 && Number(user10.is_active) === 1) return user10;
    }
  }
  return null;
}

function isUserAllowed(user) {
  if (!user) return { allowed: false, reason: 'missing' };
  if (Number(user.is_active) !== 1) return { allowed: false, reason: 'inactive' };
  if (user.expiry_date) {
    const now = new Date().toISOString().slice(0, 10);
    if (String(user.expiry_date) < now) return { allowed: false, reason: 'expired' };
  }
  return { allowed: true, reason: '' };
}

async function addAuthorizedEntry(channel, type, id, extras = {}) {
  const c = String(channel || '').toLowerCase().trim();
  const t = String(type || '').toLowerCase().trim();
  if ((c === 'wa' || c === 'whatsapp') && t === 'user') {
    const digits = normalizePhone(id); if (!digits) return null;
    const u = await repo.createUser(digits, 'wa');
    // Save raw digits@c.us alias (e.g. 9660930674@c.us)
    const rawCus = `${digits}@c.us`;
    const rawCusExists = await repo.getIdentity(rawCus);
    if (!rawCusExists) await repo.createUserIdentity(u.id, 'wa_cus', rawCus);
    // Also save 91+digits@c.us alias for reliability (e.g. 919660930674@c.us)
    // WhatsApp often sends the full international format with country code
    const withCountryCode = digits.startsWith('91') ? digits : `91${digits}`;
    const canonicalCus = `${withCountryCode}@c.us`;
    if (canonicalCus !== rawCus) {
      const canonicalCusExists = await repo.getIdentity(canonicalCus);
      if (!canonicalCusExists) await repo.createUserIdentity(u.id, 'wa_cus', canonicalCus);
    }
    await repo.updateUserProfile(digits, { name: extras.name || '', subscription_plan: extras.plan || extras.subscription_plan || 'free', monthly_limit: Number(extras.monthly_limit || 50), expiry_date: extras.expiry_date || '' });
    return u;
  }
  if ((c === 'wa' || c === 'whatsapp') && t === 'group') return repo.addAuthorizedGroup(id, 'wa');
  if ((c === 'tg' || c === 'telegram') && t === 'user') {
    const u = await repo.createUser(id, 'tg');
    await repo.updateUserProfile(id, { name: extras.name || '', subscription_plan: extras.plan || extras.subscription_plan || 'free', monthly_limit: Number(extras.monthly_limit || 50), expiry_date: extras.expiry_date || '' });
    return u;
  }
  if ((c === 'tg' || c === 'telegram') && t === 'group') return repo.addAuthorizedGroup(id, 'tg');
  return null;
}

async function removeAuthorizedEntry(channel, type, id) {
  const c = String(channel || '').toLowerCase().trim();
  const t = String(type || '').toLowerCase().trim();
  if ((c === 'wa' || c === 'whatsapp') && t === 'user') return repo.deactivateUser(normalizePhone(id));
  if ((c === 'wa' || c === 'whatsapp') && t === 'group') return repo.removeAuthorizedGroup(id, 'wa');
  if ((c === 'tg' || c === 'telegram') && t === 'user') return repo.deactivateUser(id);
  if ((c === 'tg' || c === 'telegram') && t === 'group') return repo.removeAuthorizedGroup(id, 'tg');
  return false;
}

async function listAuthorizedEntries() {
  const users = await repo.query('SELECT * FROM auth_users WHERE is_active = 1');
  const groups = await repo.getAuthorizedGroups('wa');
  const tgGroups = await repo.getAuthorizedGroups('tg');
  return { whatsapp: { users: users.filter((u) => u.channel === 'wa').map((u) => u.canonical_phone), groups: groups.map((g) => g.group_id), admins: [] }, telegram: { users: users.filter((u) => u.channel === 'tg').map((u) => u.canonical_phone), groups: tgGroups.map((g) => g.group_id), admins: [] } };
}

async function editUser(phone, updates) { return repo.updateUserProfile(phone, updates || {}); }
async function deleteUser(phone) { return repo.deactivateUser(phone); }
async function listUsers() { return repo.listAllUsers(); }
async function getUserDetails(phone) { return repo.getUserByPhone(phone); }

module.exports = { isAuthorizedWhatsApp, isAuthorizedTelegram, isAdminWhatsApp, isAdminTelegram, addAuthorizedEntry, removeAuthorizedEntry, listAuthorizedEntries, getWhatsAppSenderId, getUserForRequest, isUserAllowed, editUser, deleteUser, listUsers, getUserDetails };
