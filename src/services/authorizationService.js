const CONFIG = require('../config/config');
const repo = require('./authorizationRepository');
const { extractIdentityFromMessage, normalizePhone } = require('./authorizationNormalizer');

function getWhatsAppSenderId(message) {
  const fromId = String(message && message.from || '').trim().toLowerCase();
  const authorId = String(message && message.author || '').trim().toLowerCase();

  // Private chats: trust `from` first. Group chats: use `author`.
  const baseId = fromId.endsWith('@g.us')
    ? (authorId || fromId)
    : (fromId || authorId);

  if (baseId.endsWith('@c.us')) {
    return baseId.split('@')[0].split(':')[0].replace(/\D/g, '');
  }

  if (baseId.endsWith('@lid')) {
    return baseId;
  }

  return baseId;
}

function parseCsv(val) {
  return String(val || '').split(',').map(v => v.trim()).filter(Boolean);
}

function isAdminWhatsApp(message, config = CONFIG) {
  try {
    if (!message) return false;
    const senderId = getWhatsAppSenderId(message);

    const ownerPhone = String(config.WHATSAPP && config.WHATSAPP.PHONE_NUMBER || '').trim().replace(/\D/g, '');
    if (ownerPhone && senderId === ownerPhone) {
      return true;
    }

    const normalizedEnvAdmins = (config.SECURITY.ADMIN_USERS || []).map(u => String(u).replace(/\D/g, ''));
    if (normalizedEnvAdmins.includes(senderId)) {
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}

function isAuthorizedWhatsApp(message, config = CONFIG) {
  try {
    if (!message || !message.from) return false;
    
    if (isAdminWhatsApp(message, config)) {
      return true;
    }

    const senderId = message.from;
    if (senderId.endsWith('@g.us')) {
      const allowed = repo.getAuthorizedGroups('wa');
      if (allowed.some(g => g.group_id === senderId)) return true;
      if ((config.SECURITY.AUTHORIZED_GROUPS || []).includes(senderId)) return true;
      return false;
    }

    // Direct match against identities in DB
    const idObj = extractIdentityFromMessage(message);
    if (idObj && idObj.identities) {
      for (const val of idObj.identities) {
        if (repo.getIdentity(val)) return true;
      }
    }

    // Fallback: match canonical phone in users
    const pureSender = getWhatsAppSenderId(message);
    if (repo.getUserByPhone(pureSender)) return true;

    // Fallback: match env rules
    const normalizedEnvUsers = (config.SECURITY.AUTHORIZED_USERS || []).map(u => String(u).replace(/\D/g, ''));
    if (normalizedEnvUsers.includes(pureSender)) return true;

    return false;
  } catch (error) {
    return false;
  }
}

function isAdminTelegram(msg, config = CONFIG) {
  try {
    if (!msg || !msg.chat || !msg.chat.id) return false;
    const chatId = msg.chat.id.toString();

    const envTgAdmins = [...parseCsv(process.env.AUTHORIZED_TG_ADMINS || ''), ...(config.SECURITY.ADMIN_USERS || [])];
    if (envTgAdmins.map(String).includes(chatId)) {
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}

function isAuthorizedTelegram(msg, config = CONFIG) {
  try {
    if (!msg || !msg.chat || !msg.chat.id) return false;

    if (isAdminTelegram(msg, config)) {
      return true;
    }

    const chatId = msg.chat.id.toString();
    const chatType = msg.chat.type;

    if (chatType === 'private') {
      const u = repo.getUserByPhone(chatId);
      if (u) return true;
      const isAllowedInEnv = (config.SECURITY.AUTHORIZED_TG_USERS || []).includes(chatId);
      return isAllowedInEnv;
    }

    if (chatType === 'group' || chatType === 'supergroup') {
      const allowed = repo.getAuthorizedGroups('tg');
      if (allowed.some(g => g.group_id === chatId)) return true;
      const isAllowedInEnv = (config.SECURITY.AUTHORIZED_TG_GROUPS || []).includes(chatId);
      return isAllowedInEnv;
    }

    return false;
  } catch (error) {
    return false;
  }
}

function addAuthorizedEntry(channel, type, id) {
  const normChannel = String(channel || '').toLowerCase().trim();
  const normType = String(type || '').toLowerCase().trim();

  if (normChannel === 'wa' || normChannel === 'whatsapp') {
    if (normType === 'user') {
      const digits = normalizePhone(id);
      if (digits) {
        const u = repo.createUser(digits, 'wa');
        repo.createUserIdentity(u.id, 'wa_cus', digits + '@c.us');
      }
    } else if (normType === 'group') {
      repo.addAuthorizedGroup(id, 'wa');
    }
  } else if (normChannel === 'tg' || normChannel === 'telegram') {
    if (normType === 'user') {
      repo.createUser(id, 'tg');
    } else if (normType === 'group') {
      repo.addAuthorizedGroup(id, 'tg');
    }
  }
}

function removeAuthorizedEntry(channel, type, id) {
  const normChannel = String(channel || '').toLowerCase().trim();
  const normType = String(type || '').toLowerCase().trim();

  if (normChannel === 'wa' || normChannel === 'whatsapp') {
    if (normType === 'user') {
      const digits = normalizePhone(id);
      repo.deactivateUser(digits);
    } else if (normType === 'group') {
      repo.removeAuthorizedGroup(id, 'wa');
    }
  } else if (normChannel === 'tg' || normChannel === 'telegram') {
    if (normType === 'user') {
      repo.deactivateUser(id);
    } else if (normType === 'group') {
      repo.removeAuthorizedGroup(id, 'tg');
    }
  }
}

function listAuthorizedEntries() {
  const users = repo.querySync('SELECT * FROM auth_users WHERE is_active = 1');
  const groups = repo.getAuthorizedGroups('wa');
  const tgGroups = repo.getAuthorizedGroups('tg');

  return {
    whatsapp: {
      users: users.filter(u => u.channel === 'wa').map(u => u.canonical_phone),
      groups: groups.map(g => g.group_id),
      admins: []
    },
    telegram: {
      users: users.filter(u => u.channel === 'tg').map(u => u.canonical_phone),
      groups: tgGroups.map(g => g.group_id),
      admins: []
    }
  };
}

module.exports = {
  isAuthorizedWhatsApp,
  isAuthorizedTelegram,
  isAdminWhatsApp,
  isAdminTelegram,
  addAuthorizedEntry,
  removeAuthorizedEntry,
  listAuthorizedEntries,
  getWhatsAppSenderId
};
