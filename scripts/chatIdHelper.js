require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const CONFIG = require('../src/config/config');

const COMMAND_PATTERN = /^\/?send(?:_|\s+)chatid$/i;

function getReplyText(message) {
  const chatId = String(message && message.from || '').trim();
  const subject = String(
    (message && message._data && (
      message._data.notifyName ||
      message._data.chatName ||
      message._data.groupSubject
    )) || ''
  ).trim();

  return [
    subject ? `Chat: ${subject}` : null,
    `Chat ID: ${chatId}`,
  ].filter(Boolean).join('\n');
}

async function run() {
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: CONFIG.WHATSAPP.SESSION_NAME,
    }),
    puppeteer: {
      headless: CONFIG.PUPPETEER.HEADLESS,
      executablePath: CONFIG.PUPPETEER.EXECUTABLE_PATH || undefined,
      args: CONFIG.PUPPETEER.ARGS || [],
    },
  });

  client.on('qr', (qrValue) => {
    console.log('Scan QR to start chat ID helper.');
    qrcode.generate(qrValue, { small: true });
  });

  client.on('ready', () => {
    console.log('WhatsApp chat ID helper is online.');
    console.log('Send `send_chatid` in any personal chat or group to get that ID.');
  });

  client.on('auth_failure', (message) => {
    console.error(`Auth failure: ${message}`);
    process.exit(1);
  });

  client.on('disconnected', (reason) => {
    console.error(`WhatsApp disconnected: ${reason}`);
  });

  client.on('message', async (message) => {
    const body = String(message && message.body || '').trim();
    if (!COMMAND_PATTERN.test(body)) {
      return;
    }

    const replyText = getReplyText(message);
    console.log(`send_chatid matched from ${message.from}`);

    try {
      await message.reply(replyText);
      console.log(`Replied with chat ID for ${message.from}`);
    } catch (error) {
      console.error(`Failed to reply for ${message.from}: ${error.message}`);
    }
  });

  await client.initialize();
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
