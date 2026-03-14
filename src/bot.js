/**
 * Bot bootstrap responsibility:
 * Initialize WhatsApp client and route incoming commands.
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const CONFIG = require('./config/config');
const { isAuthorized } = require('./core/auth');
const { broadcastPairingCode, formatPairingCode } = require('./services/pairingCodeNotifier');
const { setWhatsAppClient } = require('./services/chatNotifier');
const { readTrackedApplications } = require('./services/autoTrackService');
const {
  addTrack: addVahanTrack,
  getHelpText,
  handleIncomingText: handleVahanIncomingText,
  hasActiveSession: hasActiveVahanSession,
  listTrack: listVahanTrack,
  removeTrack: removeVahanTrack,
  startLookup: startVahanLookup,
  startPolling: startVahanPolling,
  stopSession: stopVahanSession,
} = require('./services/vahanService');

const trackCommand = require('./commands/track');
const aliveCommand = require('./commands/alive');
const applCommand = require('./commands/appl');
const addTrackCommand = require('./commands/addTrack');
const form1Command = require('./commands/form1');
const form1aCommand = require('./commands/form1a');
const form2Command = require('./commands/form2');
const formsetCommand = require('./commands/formset');
const removeTrackCommand = require('./commands/removeTrack');

function normalizePhoneNumber(phoneNumber) {
  return String(phoneNumber || '').replace(/\D/g, '');
}

async function createBot() {
  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    ...(CONFIG.PUPPETEER.ARGS || []),
  ];
  const pairingPhoneNumber = normalizePhoneNumber(CONFIG.WHATSAPP.PHONE_NUMBER);

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
  setWhatsAppClient(client);
  let lastPairingCode = null;

  async function handlePairingCode(code) {
    const normalizedCode = String(code || '').replace(/\s+/g, '').trim();

    if (!normalizedCode || normalizedCode === lastPairingCode) {
      return;
    }

    lastPairingCode = normalizedCode;

    try {
      const result = await broadcastPairingCode(normalizedCode, CONFIG);
      console.log(`WhatsApp pairing code generated: ${formatPairingCode(normalizedCode)}`);

      if (result.failures.length > 0 && CONFIG.DEBUG) {
        console.error('Some pairing code notifications failed.');
        console.error(result.failures.join('\n'));
      }
    } catch (error) {
      console.error('Failed to broadcast pairing code.');
      console.error(error.message);
    }
  }

  client.on('qr', (qr) => {
    if (pairingPhoneNumber) {
      console.log('Pairing phone number detected. Skipping terminal QR output.');
      return;
    }

    qrcode.generate(qr, { small: true });
  });

  client.on('code', async (code) => {
    await handlePairingCode(code);
  });

  client.on('ready', () => {
    console.log('WhatsApp bot is online.');
  });

  startVahanPolling(client);

  client.on('message', async (message) => {
    // Authorization check: only allow authorized users and groups
    if (!isAuthorized(message, CONFIG)) {
      return; // Silently ignore unauthorized
    }

    const parts = (message.body || '').trim().split(/\s+/);
    const command = (parts[0] || '').toLowerCase();
    const normalizedBody = String(message.body || '').trim();
    const addTrackMatch = normalizedBody.match(/^add\s+track\s+(\d+)(?:\s*-\s*(.+))?$/i);
    const removeTrackMatch = normalizedBody.match(/^remove\s+track\s+(\d+)$/i);
    const addTrackRcMatch = normalizedBody.match(/^add\s+track\s+rc\s+([A-Z0-9]+)(?:\s*-\s*(.+))?$/i);
    const removeTrackRcMatch = normalizedBody.match(/^remove\s+track\s+rc\s+([A-Z0-9]+)$/i);
    const trackRcMatch = normalizedBody.match(/^track\s+rc\s+([A-Z0-9]+)$/i);

    try {
      if (/^help$/i.test(normalizedBody)) {
        await message.reply(getHelpText());
        return;
      }

      if (/^list\s+track$/i.test(normalizedBody)) {
        const sarathiTracked = readTrackedApplications().filter(
          (item) => item.transport === 'whatsapp' && item.chatId === message.from
        );
        const tracked = listVahanTrack(message.from);
        await message.reply(
          !sarathiTracked.length && !tracked.length
            ? 'No applications are being tracked.'
            : [
                'Sarathi:',
                sarathiTracked.length
                  ? sarathiTracked
                      .map((item, index) => `${index + 1}. ${item.appNo}${item.tag ? ` - ${item.tag}` : ''}`)
                      .join('\n')
                  : 'None',
                '-----',
                'Vahan:',
                tracked.length
                  ? tracked
                      .map((item, index) => `${index + 1}. ${item.applicationNumber}${item.tag ? ` - ${item.tag}` : ''}`)
                      .join('\n')
                  : 'None',
              ].join('\n')
        );
        return;
      }

      if (addTrackRcMatch) {
        const result = addVahanTrack(message.from, addTrackRcMatch[1], addTrackRcMatch[2]);
        await message.reply(
          result.created
            ? `Vahan tracking added for ${addTrackRcMatch[1]}${addTrackRcMatch[2] ? ` - ${addTrackRcMatch[2].trim()}` : ''}.`
            : `Vahan tracking already exists for ${addTrackRcMatch[1]}.`
        );
        return;
      }

      if (removeTrackRcMatch) {
        const result = removeVahanTrack(message.from, removeTrackRcMatch[1]);
        await message.reply(
          result.removed
            ? `Vahan tracking removed for ${removeTrackRcMatch[1]}.`
            : `No Vahan tracking entry found for ${removeTrackRcMatch[1]}.`
        );
        return;
      }

      if (trackRcMatch) {
        await message.reply('Fetching Vahan captcha...');
        await startVahanLookup(client, message.from, trackRcMatch[1]);
        return;
      }

      if (/^stop$/i.test(normalizedBody) && hasActiveVahanSession(message.from)) {
        await stopVahanSession(message.from);
        await message.reply('Vahan session stopped.');
        return;
      }

      if (addTrackMatch) {
        await addTrackCommand(message, 'whatsapp', message.from, addTrackMatch[1], addTrackMatch[2]);
        return;
      }

      if (removeTrackMatch) {
        await removeTrackCommand(message, 'whatsapp', message.from, removeTrackMatch[1]);
        return;
      }

      switch (command) {
        case 'suno':
        case 'alive':
          await aliveCommand(client, message, MessageMedia);
          break;
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
        case 'formset':
          await formsetCommand(client, message);
          break;
        default:
          if (hasActiveVahanSession(message.from)) {
            await handleVahanIncomingText(client, message.from, normalizedBody);
          }
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
