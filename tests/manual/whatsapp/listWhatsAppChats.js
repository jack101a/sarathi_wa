require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const CONFIG = require('../../../src/config/config');

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function run() {
  const filter = normalizeText(process.argv.slice(2).join(' '));
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

  client.on('ready', async () => {
    const chats = await client.getChats();
    const rows = chats
      .map((chat) => ({
        name: String(chat.name || chat.formattedTitle || chat.id?._serialized || '').trim(),
        id: String(chat.id?._serialized || '').trim(),
      }))
      .filter((chat) => chat.id)
      .filter((chat) => !filter || normalizeText(chat.name).includes(filter) || normalizeText(chat.id).includes(filter));

    if (!rows.length) {
      console.log('No chats matched.');
    } else {
      rows.forEach((chat) => {
        console.log(`${chat.name || '(no name)'} -> ${chat.id}`);
      });
    }

    await client.destroy();
    process.exit(0);
  });

  client.on('auth_failure', async (message) => {
    console.error(`Auth failure: ${message}`);
    process.exit(1);
  });

  client.on('qr', () => {
    console.error('QR authentication is required before chat IDs can be listed.');
  });

  await client.initialize();
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
