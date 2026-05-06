const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config/config');

let activeWhatsAppClient = null;
let activeTelegramBot = null;

function setWhatsAppClient(client) { activeWhatsAppClient = client; }
function setTelegramBot(bot) { activeTelegramBot = bot; }

function normalizeTargets(values) { return values.map((value) => String(value || '').trim()).filter(Boolean); }
function getTelegramNotificationTargets() {
  const configuredTargets = normalizeTargets(CONFIG.TELEGRAM.NOTIFY_CHAT_IDS || []);
  if (configuredTargets.length > 0) return configuredTargets;
  return normalizeTargets([...(CONFIG.SECURITY.AUTHORIZED_TG_USERS || []), ...(CONFIG.SECURITY.AUTHORIZED_TG_GROUPS || [])]);
}

async function sendWhatsAppText(chatId, text, options = {}) { if (!activeWhatsAppClient) throw new Error('WhatsApp client is not ready.'); await activeWhatsAppClient.sendMessage(chatId, text, options); return true; }
async function sendWhatsAppMedia(chatId, buffer, mimeType, filename, caption) { if (!activeWhatsAppClient) throw new Error('WhatsApp client is not ready.'); const media = new MessageMedia(mimeType, Buffer.from(buffer).toString('base64'), filename); await activeWhatsAppClient.sendMessage(chatId, media, { caption }); return true; }
async function sendWhatsAppImage(chatId, buffer, filename, caption) { return sendWhatsAppMedia(chatId, buffer, 'image/jpeg', filename, caption); }

async function sendTelegramMessage(chatId, text, options = {}) { if (!activeTelegramBot) throw new Error('Telegram bot is not ready.'); await activeTelegramBot.sendMessage(chatId, text, options); return true; }
async function sendTelegramPhoto(chatId, buffer, filename, caption, contentType = 'image/jpeg') { if (!activeTelegramBot) throw new Error('Telegram bot is not ready.'); await activeTelegramBot.sendPhoto(chatId, buffer, { caption }, { filename, contentType }); return true; }
async function sendTelegramDocument(chatId, buffer, filename, caption, contentType = 'application/pdf') { if (!activeTelegramBot) throw new Error('Telegram bot is not ready.'); await activeTelegramBot.sendDocument(chatId, buffer, { caption }, { filename, contentType }); return true; }

module.exports = { getTelegramNotificationTargets, sendTelegramMessage, sendWhatsAppMedia, sendWhatsAppText, setWhatsAppClient, setTelegramBot, sendWhatsAppImage, sendTelegramPhoto, sendTelegramDocument };
