const { MessageMedia } = require('whatsapp-web.js');

let activeWhatsAppClient = null;
let activeTelegramBot = null;

function setWhatsAppClient(client) {
  activeWhatsAppClient = client;
}

function setTelegramBot(bot) {
  activeTelegramBot = bot;
}

async function sendWhatsAppImage(chatId, buffer, filename, caption) {
  if (!activeWhatsAppClient) {
    throw new Error('WhatsApp client is not ready.');
  }

  const media = new MessageMedia('image/jpeg', Buffer.from(buffer).toString('base64'), filename);
  await activeWhatsAppClient.sendMessage(chatId, media, { caption });
  return true;
}

async function sendTelegramPhoto(chatId, buffer, filename, caption) {
  if (!activeTelegramBot) {
    throw new Error('Telegram bot is not ready.');
  }

  await activeTelegramBot.sendPhoto(
    chatId,
    buffer,
    {
      caption,
    },
    {
      filename,
      contentType: 'image/jpeg',
    }
  );

  return true;
}

module.exports = {
  setWhatsAppClient,
  setTelegramBot,
  sendWhatsAppImage,
  sendTelegramPhoto,
};
