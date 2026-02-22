/**
 * Bot bootstrap responsibility:
 * Initialize WhatsApp client and route incoming commands.
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const CONFIG = require('./config/config');
const { isAuthorized } = require('./core/auth');

const trackCommand = require('./commands/track');
const applCommand = require('./commands/appl');
const form1Command = require('./commands/form1');
const form1aCommand = require('./commands/form1a');
const form2Command = require('./commands/form2');

async function createBot() {
  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    ...(CONFIG.PUPPETEER.ARGS || []),
  ];

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: CONFIG.WHATSAPP.SESSION_NAME,
    }),
    puppeteer: {
      headless: CONFIG.PUPPETEER.HEADLESS,
      executablePath: CONFIG.PUPPETEER.EXECUTABLE_PATH || undefined,
      args: [...new Set(puppeteerArgs)],
    },
  });

  client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('WhatsApp bot is online.');
  });

  client.on('message', async (message) => {
    // Authorization check: only allow authorized users and groups
    if (!isAuthorized(message, CONFIG)) {
      return; // Silently ignore unauthorized
    }

    const parts = (message.body || '').trim().split(/\s+/);
    const command = (parts[0] || '').toLowerCase();

    try {
      switch (command) {
        case 'track':
          await trackCommand(client, message, MessageMedia);
          break;
        case 'appl':
          await applCommand(client, message, MessageMedia);
          break;
        case 'form1':
          await form1Command(client, message, MessageMedia);
          break;
        case 'form1a':
          await form1aCommand(client, message, MessageMedia);
          break;
        case 'form2':
          await form2Command(client, message, MessageMedia);
          break;
        default:
          break;
      }
    } catch (error) {
      await message.reply('Something went wrong. Please try again later.');
    }
  });

  await client.initialize();
  return client;
}

module.exports = {
  createBot,
};
