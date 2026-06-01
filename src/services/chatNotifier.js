const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config/config');

let activeWhatsAppClient = null;
let activeTelegramBot = null;

let commonNotifier = null;
try {
  commonNotifier = require('@sarathi/common').chatNotifier;
} catch (_) {}

function setWhatsAppClient(client) { activeWhatsAppClient = client; }
function setTelegramBot(bot) { activeTelegramBot = bot; }

function normalizeTargets(values) { return values.map((value) => String(value || '').trim()).filter(Boolean); }
function getTelegramNotificationTargets() {
  if (!activeTelegramBot && commonNotifier) {
    return commonNotifier.getTelegramNotificationTargets();
  }
  const configuredTargets = normalizeTargets(CONFIG.TELEGRAM.NOTIFY_CHAT_IDS || []);
  if (configuredTargets.length > 0) return configuredTargets;
  return normalizeTargets([...(CONFIG.SECURITY.AUTHORIZED_TG_USERS || []), ...(CONFIG.SECURITY.AUTHORIZED_TG_GROUPS || [])]);
}

async function sendWhatsAppText(chatId, text, options = {}) {
  if (activeWhatsAppClient) {
    await activeWhatsAppClient.sendMessage(chatId, text, options);
    return true;
  }
  if (commonNotifier) {
    return commonNotifier.sendWhatsAppText(chatId, text, options);
  }
  throw new Error('WhatsApp client is not ready.');
}

async function sendWhatsAppMedia(chatId, buffer, mimeType, filename, caption) {
  if (activeWhatsAppClient) {
    const media = new MessageMedia(mimeType, Buffer.from(buffer).toString('base64'), filename);
    await activeWhatsAppClient.sendMessage(chatId, media, { caption });
    return true;
  }
  if (commonNotifier) {
    return commonNotifier.sendWhatsAppMedia(chatId, buffer, mimeType, filename, caption);
  }
  throw new Error('WhatsApp client is not ready.');
}

async function sendWhatsAppImage(chatId, buffer, filename, caption) {
  return sendWhatsAppMedia(chatId, buffer, 'image/jpeg', filename, caption);
}

async function sendTelegramMessage(chatId, text, options = {}) {
  if (activeTelegramBot) {
    await activeTelegramBot.sendMessage(chatId, text, options);
    return true;
  }
  if (commonNotifier) {
    return commonNotifier.sendTelegramMessage(chatId, text, options);
  }
  throw new Error('Telegram bot is not ready.');
}

async function sendTelegramPhoto(chatId, buffer, filename, caption, contentType = 'image/jpeg') {
  if (activeTelegramBot) {
    await activeTelegramBot.sendPhoto(chatId, buffer, { caption }, { filename, contentType });
    return true;
  }
  if (commonNotifier) {
    return commonNotifier.sendTelegramPhoto(chatId, buffer, filename, caption, contentType);
  }
  throw new Error('Telegram bot is not ready.');
}

async function sendTelegramDocument(chatId, buffer, filename, caption, contentType = 'application/pdf') {
  if (activeTelegramBot) {
    await activeTelegramBot.sendDocument(chatId, buffer, { caption }, { filename, contentType });
    return true;
  }
  if (commonNotifier) {
    return commonNotifier.sendTelegramDocument(chatId, buffer, filename, caption, contentType);
  }
  throw new Error('Telegram bot is not ready.');
}

module.exports = {
  getTelegramNotificationTargets,
  sendTelegramMessage,
  sendWhatsAppMedia,
  sendWhatsAppText,
  setWhatsAppClient,
  setTelegramBot,
  sendWhatsAppImage,
  sendTelegramPhoto,
  sendTelegramDocument
};

