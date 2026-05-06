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
      for (const val of idObj.identities) { if (await repo.getIdentity(val)) return true; }
    }
    const pureSender = getWhatsAppSenderId(message);
    if (await repo.getUserByPhone(pureSender)) return true;
    const envUsers = (config.SECURITY.AUTHORIZED_USERS || []).map((u) => String(u).replace(/\D/g, ''));
    return envUsers.includes(pureSender);
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
  const phone = getWhatsAppSenderId(message);
  return phone ? repo.getUserByPhone(phone) : null;
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
    await repo.createUserIdentity(u.id, 'wa_cus', `${digits}@c.us`);
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
