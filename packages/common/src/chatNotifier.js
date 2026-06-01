const { redis } = require('./redis');
const CONFIG = require('./config');

function normalizeTargets(values) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function getTelegramNotificationTargets() {
  const configuredTargets = normalizeTargets(CONFIG.TELEGRAM.NOTIFY_CHAT_IDS || []);
  if (configuredTargets.length > 0) return configuredTargets;
  return normalizeTargets([
    ...(CONFIG.SECURITY.AUTHORIZED_TG_USERS || []),
    ...(CONFIG.SECURITY.AUTHORIZED_TG_GROUPS || [])
  ]);
}

async function sendWhatsAppText(chatId, text, options = {}) {
  const payload = { type: 'text', text, options };
  await redis.publish(`chat:response:whatsapp:${chatId}`, JSON.stringify(payload));
  return true;
}

async function sendWhatsAppMedia(chatId, buffer, mimeType, filename, caption = '') {
  const payload = {
    type: 'media',
    buffer: Buffer.from(buffer).toString('base64'),
    mimeType,
    filename,
    caption
  };
  await redis.publish(`chat:response:whatsapp:${chatId}`, JSON.stringify(payload));
  return true;
}

async function sendWhatsAppImage(chatId, buffer, filename, caption = '') {
  return sendWhatsAppMedia(chatId, buffer, 'image/jpeg', filename, caption);
}

async function sendTelegramMessage(chatId, text, options = {}) {
  const payload = { type: 'text', text, options };
  await redis.publish(`chat:response:telegram:${chatId}`, JSON.stringify(payload));
  return true;
}

async function sendTelegramPhoto(chatId, buffer, filename, caption = '', contentType = 'image/jpeg') {
  const payload = {
    type: 'photo',
    buffer: Buffer.from(buffer).toString('base64'),
    filename,
    caption,
    contentType
  };
  await redis.publish(`chat:response:telegram:${chatId}`, JSON.stringify(payload));
  return true;
}

async function sendTelegramDocument(chatId, buffer, filename, caption = '', contentType = 'application/pdf') {
  const payload = {
    type: 'document',
    buffer: Buffer.from(buffer).toString('base64'),
    filename,
    caption,
    contentType
  };
  await redis.publish(`chat:response:telegram:${chatId}`, JSON.stringify(payload));
  return true;
}

async function sendDiscordAlert(title, description, level = 'info') {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
  if (!webhookUrl) return false;

  let color = 3447003; // Blue for info
  if (level === 'error' || level === 'danger') {
    color = 15158332; // Red
  } else if (level === 'warning') {
    color = 15105570; // Orange
  } else if (level === 'success') {
    color = 3066993; // Green
  }

  const payload = {
    embeds: [{
      title: title || 'System Notification',
      description: description || '',
      color,
      timestamp: new Date().toISOString()
    }]
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (err) {
    console.error(`[chatNotifier] Failed to send Discord alert: ${err.message}`);
    return false;
  }
}

module.exports = {
  getTelegramNotificationTargets,
  sendWhatsAppText,
  sendWhatsAppMedia,
  sendWhatsAppImage,
  sendTelegramMessage,
  sendTelegramPhoto,
  sendTelegramDocument,
  sendDiscordAlert
};
