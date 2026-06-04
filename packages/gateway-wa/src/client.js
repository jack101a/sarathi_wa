const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { config: CONFIG, redis } = require('@sarathi/common');
const {
  cleanupWhatsAppAuthLocks,
  cleanupWhatsAppRuntimeCache,
  releaseStaleWhatsAppProfileLocks,
} = require('./runtimeCleanup');

function normalizePhoneNumber(phoneNumber) {
  return String(phoneNumber || '').replace(/\D/g, '');
}

async function createWhatsAppClient(onMessageReceived) {
  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    ...(CONFIG.PUPPETEER.ARGS || []),
  ];
  const pairingPhoneNumber = normalizePhoneNumber(CONFIG.WHATSAPP.PHONE_NUMBER);

  // Clean stale chromium profiles/locks on startup
  const releaseResult = releaseStaleWhatsAppProfileLocks();
  if (releaseResult.attempted && releaseResult.killed > 0) {
    console.log(`[Client] Stopped ${releaseResult.killed} stale Chromium profile process(es).`);
  }

  const lockCleanup = cleanupWhatsAppAuthLocks();
  const cacheCleanup = cleanupWhatsAppRuntimeCache();
  if (lockCleanup.deleted.length > 0 || lockCleanup.busyCount > 0) {
    console.log(`[Client] WhatsApp auth lock cleanup: deleted=${lockCleanup.deleted.length}, busy=${lockCleanup.busyCount}`);
  }
  if (cacheCleanup.deleted.length > 0 || cacheCleanup.busyCount > 0) {
    console.log(`[Client] WhatsApp runtime cache cleanup: deleted=${cacheCleanup.deleted.length}, busy=${cacheCleanup.busyCount}`);
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: CONFIG.WHATSAPP.SESSION_NAME,
    }),
    pairWithPhoneNumber: pairingPhoneNumber
      ? {
          phoneNumber: pairingPhoneNumber,
          showNotification: true,
        }
      : undefined,
    puppeteer: {
      headless: CONFIG.PUPPETEER.HEADLESS,
      executablePath: CONFIG.PUPPETEER.EXECUTABLE_PATH || undefined,
      args: [...new Set(puppeteerArgs)],
    },
  });

  client.on('qr', (qr) => {
    if (pairingPhoneNumber) {
      console.log('[Client] Pairing phone number detected. Skipping terminal QR output.');
      return;
    }
    qrcode.generate(qr, { small: true });
  });

  client.on('code', (code) => {
    const normalizedCode = String(code || '').replace(/\s+/g, '').trim();
    console.log(`[Client] WhatsApp pairing code generated: ${normalizedCode}`);
  });

  let isBotReady = false;

  client.on('ready', () => {
    console.log('[Client] WhatsApp bot is online and ready.');
    isBotReady = true;
  });

  client.on('disconnected', (reason) => {
    console.error(`[Client] WhatsApp bot disconnected! Reason: ${reason}`);
    isBotReady = false;
  });

  client.on('auth_failure', (msg) => {
    console.error(`[Client] WhatsApp bot authentication failure! Message: ${msg}`);
    isBotReady = false;
  });

  // Intercept and wrap sendMessage to deduplicate outgoing messages
  const originalSendMessage = client.sendMessage.bind(client);
  client.sendMessage = async function(chatId, content, options) {
    const result = await originalSendMessage(chatId, content, options);
    if (result && result.id && result.id.id) {
      await redis.setex(`dedup:msg:${result.id.id}`, 300, Date.now().toString()).catch(() => {});
    }
    return result;
  };

  client.on('message_create', async (message) => {
    if (!message) return;

    // Allow self-issued command messages, but ignore self echo chatter/status texts.
    if (message.fromMe) {
      const ownBody = String(message.body || '').trim();
      const looksLikeCommand = /^(help|balance|bal|history|txn|plan|topup|track|add|remove|refresh|list|alive|suno|appl|app|dl|ll|slot|form1|form1a|form2|formset|stop|auth|resend|\/?llprint|\/?lledit|\/?payfee|\/?feeprint|\/?fees|\/?dlrenewal|\/?dlapp|\/?bookslot|\/?mobupdate|\/?send(?:_|\s+)chatid)\b/i.test(ownBody);
      if (!looksLikeCommand) {
        return;
      }
    }

    if (message.id && message.id.id) {
      const exists = await redis.exists(`dedup:msg:${message.id.id}`).catch(() => 0);
      if (exists) {
        await redis.del(`dedup:msg:${message.id.id}`).catch(() => {});
        return;
      }
    }

    await onMessageReceived(client, message);
  });

  await client.initialize();

  return client;
}

module.exports = {
  createWhatsAppClient
};
