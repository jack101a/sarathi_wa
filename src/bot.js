/**
 * Bot bootstrap responsibility:
 * Initialize WhatsApp client and route incoming commands.
 */

const { create } = require('@open-wa/wa-automate');
const CONFIG = require('./config/config');
const { notifyQRCode } = require('./utils/discordNotifier');

const trackCommand = require('./commands/track');
const applCommand = require('./commands/appl');
const form1Command = require('./commands/form1');
const form1aCommand = require('./commands/form1a');
const form2Command = require('./commands/form2');

async function createBot() {
  let currentQrString = '';
  let lastNotifiedQr = '';
  let lastState = '';

  const client = await create({
    sessionId: CONFIG.WHATSAPP.SESSION_ID,
    multiDevice: CONFIG.WHATSAPP.MULTI_DEVICE,
    headless: CONFIG.PUPPETEER.HEADLESS,
    authTimeout: CONFIG.WHATSAPP.AUTH_TIMEOUT_SEC,
    blockCrashLogs: true,
    catchQR: async (qrBase64) => {
      if (!qrBase64 || qrBase64 === currentQrString) {
        return;
      }

      currentQrString = qrBase64;

      if (qrBase64 === lastNotifiedQr) {
        return;
      }

      try {
        const sent = await notifyQRCode(
          qrBase64,
          'WhatsApp QR generated - Scan to login'
        );
        if (sent) {
          lastNotifiedQr = qrBase64;
        }
      } catch (error) {
        console.error(`Failed to send Discord QR alert: ${error.message}`);
      }
    },
  });

  console.log('WhatsApp bot is online.');

  client.onStateChanged(async (state) => {
    if (state === 'UNPAIRED' && lastState !== 'UNPAIRED') {
      if (!currentQrString) {
        console.warn('UNPAIRED state detected but no QR is available yet.');
      } else {
        try {
          const sent = await notifyQRCode(
            currentQrString,
            'WhatsApp session logged out - Scan to relogin'
          );
          if (sent) {
            lastNotifiedQr = currentQrString;
          }
        } catch (error) {
          console.error(`Failed to send Discord UNPAIRED alert: ${error.message}`);
        }
      }
    }

    lastState = state;
  });

  client.onMessage(async (message) => {
    const parts = (message.body || '').trim().split(/\s+/);
    const command = (parts[0] || '').toLowerCase();

    try {
      switch (command) {
        case 'track':
          await trackCommand(client, message);
          break;
        case 'appl':
          await applCommand(client, message);
          break;
        case 'form1':
          await form1Command(client, message);
          break;
        case 'form1a':
          await form1aCommand(client, message);
          break;
        case 'form2':
          await form2Command(client, message);
          break;
        default:
          break;
      }
    } catch (error) {
      await client.sendText(
        message.from,
        'Something went wrong. Please try again later.'
      );
    }
  });

  return client;
}

module.exports = {
  createBot,
};
