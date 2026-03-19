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
const {
  addTrack: addVahanTrack,
  getHelpText,
  handleIncomingText: handleVahanIncomingText,
  hasActiveSession: hasActiveVahanSession,
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
const {
  extractAppNoAndDob,
  decodeAppNoAndDobFromImage,
  normalizeDob,
} = require('./services/commandInputService');
const {
  buildTrackedItemsMessage,
  hasTrackedItems,
  isVahanTrackedAnywhere,
  refreshAllTrackedApplications,
  removeVahanTrackEverywhere,
} = require('./services/trackingControlService');

const TRACK_DOB_TIMEOUT_MS = 120 * 1000;
const pendingDobRequests = new Map();
const interactiveAddTrackFlows = new Map();
let activeWhatsAppClient = null;

const vahanWhatsAppClient = {
  sendImage: async (chatId, imagePath, caption) => {
    const media = MessageMedia.fromFilePath(imagePath);
    await activeWhatsAppClient.sendMessage(chatId, media, { caption });
  },
  sendText: async (chatId, text) => {
    await activeWhatsAppClient.sendMessage(chatId, text);
  },
};

function normalizePhoneNumber(phoneNumber) {
  return String(phoneNumber || '').replace(/\D/g, '');
}

function getChatIdReplyText(message) {
  const chatId = String(message && message.from || '').trim();
  const subject = String(
    message && (
      message._data && (message._data.notifyName || message._data.chatName || message._data.groupSubject)
    ) || ''
  ).trim();

  return [
    subject ? `Chat: ${subject}` : null,
    `Chat ID: ${chatId}`,
  ].filter(Boolean).join('\n');
}

function isChatIdCommand(value) {
  return /^\/?send(?:_|\s+)chatid$/i.test(String(value || '').trim());
}

function clearPendingDobRequest(chatId) {
  const pending = pendingDobRequests.get(chatId);
  if (!pending) {
    return null;
  }

  clearTimeout(pending.timeoutId);
  pendingDobRequests.delete(chatId);
  return pending;
}

function clearInteractiveAddTrackFlow(chatId) {
  interactiveAddTrackFlows.delete(chatId);
}

async function startInteractiveAddTrackFlow(message) {
  interactiveAddTrackFlows.set(message.from, {
    step: 'serviceType',
    data: {},
  });

  await message.reply('Add track started. Reply with `dl` or `rc`.');
}

async function handleInteractiveAddTrackFlow(message) {
  const flow = interactiveAddTrackFlows.get(message.from);
  if (!flow) {
    return false;
  }

  const value = String(message.body || '').trim();
  if (/^(cancel|stop)$/i.test(value)) {
    clearInteractiveAddTrackFlow(message.from);
    await message.reply('Add track cancelled.');
    return true;
  }

  if (flow.step === 'serviceType') {
    if (!/^(dl|rc)$/i.test(value)) {
      await message.reply('Reply with `dl` for Sarathi or `rc` for Vahan.');
      return true;
    }

    flow.data.serviceType = value.toLowerCase();
    flow.step = 'appNo';
    await message.reply('Send the application number.');
    return true;
  }

  if (flow.step === 'appNo') {
    const appNo = value.replace(/\s+/g, '');
    if (!/^[A-Z0-9]+$/i.test(appNo)) {
      await message.reply('Send a valid application number.');
      return true;
    }

    flow.data.appNo = appNo;
    if (flow.data.serviceType === 'dl') {
      flow.step = 'dob';
      await message.reply('Send DOB in `DD-MM-YYYY` format.');
      return true;
    }

    flow.step = 'tag';
    await message.reply('Send an optional name/tag, or reply `skip`.');
    return true;
  }

  if (flow.step === 'dob') {
    const dob = normalizeDob(value);
    if (!dob) {
      await message.reply('Send DOB in `DD-MM-YYYY` format.');
      return true;
    }

    flow.data.dob = dob;
    flow.step = 'tag';
    await message.reply('Send an optional name/tag, or reply `skip`.');
    return true;
  }

  if (flow.step === 'tag') {
    const tag = /^skip$/i.test(value) ? '' : value;
    clearInteractiveAddTrackFlow(message.from);

    if (flow.data.serviceType === 'rc') {
      const result = addVahanTrack(message.from, flow.data.appNo, tag, 'whatsapp');
      await message.reply(
        result.created
          ? `Vahan tracking added for ${flow.data.appNo}${tag ? ` - ${tag}` : ''}.`
          : `Vahan tracking already exists for ${flow.data.appNo}.`
      );
      return true;
    }

    await addTrackCommand(
      message,
      'whatsapp',
      message.from,
      flow.data.appNo,
      tag,
      flow.data.dob
    );
    return true;
  }

  return false;
}

async function downloadMediaInput(message) {
  if (!message || !message.hasMedia || typeof message.downloadMedia !== 'function') {
    return null;
  }

  const media = await message.downloadMedia();
  if (!media || !media.data) {
    return null;
  }

  return {
    mimeType: media.mimetype || 'image/jpeg',
    buffer: Buffer.from(media.data, 'base64'),
  };
}

async function extractTrackInputFromMessage(message, fallbackCommandText = '') {
  const fromCommand = extractAppNoAndDob(fallbackCommandText);
  if (fromCommand.appNo) {
    return fromCommand;
  }

  const ownText = extractAppNoAndDob(message.body || '');
  if (ownText.appNo) {
    return ownText;
  }

  const ownMedia = await downloadMediaInput(message);
  if (ownMedia) {
    const decodedOwnMedia = await decodeAppNoAndDobFromImage(ownMedia.buffer, ownMedia.mimeType);
    if (decodedOwnMedia.appNo) {
      return decodedOwnMedia;
    }
  }

  if (message.hasQuotedMsg && typeof message.getQuotedMessage === 'function') {
    const quotedMessage = await message.getQuotedMessage();
    if (quotedMessage) {
      const quotedText = extractAppNoAndDob(quotedMessage.body || '');
      if (quotedText.appNo) {
        return quotedText;
      }

      const quotedMedia = await downloadMediaInput(quotedMessage);
      if (quotedMedia) {
        const decodedQuotedMedia = await decodeAppNoAndDobFromImage(
          quotedMedia.buffer,
          quotedMedia.mimeType
        );
        if (decodedQuotedMedia.appNo) {
          return decodedQuotedMedia;
        }
      }
    }
  }

  return {
    appNo: '',
    dob: '',
    sourceText: '',
  };
}

async function startPendingDobFlow(client, message, MessageMedia, appNo) {
  clearPendingDobRequest(message.from);

  const timeoutId = setTimeout(async () => {
    const pending = pendingDobRequests.get(message.from);
    if (!pending || pending.appNo !== appNo) {
      return;
    }

    pendingDobRequests.delete(message.from);

    try {
      await trackCommand(client, message, MessageMedia, { appNo });
    } catch (error) {
      await message.reply('Not Found');
    }
  }, TRACK_DOB_TIMEOUT_MS);

  pendingDobRequests.set(message.from, {
    appNo,
    timeoutId,
  });

  await message.reply(
    `DOB not found in the QR/barcode. Reply with DOB in 120 seconds to merge acknowledgement, otherwise I will track ${appNo} with application number only.`
  );
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
  activeWhatsAppClient = client;
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

  startVahanPolling(vahanWhatsAppClient, 'whatsapp');

  async function handleMessage(message, eventName = 'message') {
    const normalizedBody = String(message.body || '').trim();

    if (isChatIdCommand(normalizedBody)) {
      await message.reply(getChatIdReplyText(message));
      return;
    }

    // Authorization check: only allow authorized users and groups
    if (!isAuthorized(message, CONFIG)) {
      return; // Silently ignore unauthorized
    }

    const parts = (message.body || '').trim().split(/\s+/);
    const command = (parts[0] || '').toLowerCase();
    const addTrackMatch = normalizedBody.match(/^add\s+track(?:\s+(\d+))?(?:\s+(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}))?(?:\s*-\s*(.+))?$/i);
    const removeTrackMatch = normalizedBody.match(/^remove\s+track\s+(\d+)$/i);
    const addTrackRcMatch = normalizedBody.match(/^add\s+track\s+rc\s+([A-Z0-9]+)(?:\s*-\s*(.+))?$/i);
    const removeTrackRcMatch = normalizedBody.match(/^remove\s+track\s+rc\s+([A-Z0-9]+)$/i);
    const trackRcMatch = normalizedBody.match(/^track\s+rc\s+([A-Z0-9]+)$/i);

    try {
      if (CONFIG.AUTO_TRACK.UPDATE_CHAT_ID && message.from === CONFIG.AUTO_TRACK.UPDATE_CHAT_ID) {
        return;
      }

      if (await handleInteractiveAddTrackFlow(message)) {
        return;
      }

      const pendingDob = pendingDobRequests.get(message.from);
      if (pendingDob && !/^track\b/i.test(normalizedBody)) {
        const suppliedDob = normalizeDob(normalizedBody);
        if (suppliedDob) {
          clearPendingDobRequest(message.from);
          await trackCommand(client, message, MessageMedia, {
            appNo: pendingDob.appNo,
            dob: suppliedDob,
          });
          return;
        }
      }

      if (/^help$/i.test(normalizedBody)) {
        await message.reply(getHelpText());
        return;
      }

      if (/^list\s+track$/i.test(normalizedBody)) {
        await message.reply(buildTrackedItemsMessage());
        return;
      }

      if (/^refresh\s+track$/i.test(normalizedBody)) {
        if (!hasTrackedItems()) {
          await message.reply('No applications are being tracked.');
          return;
        }

        await refreshAllTrackedApplications();
        return;
      }

      if (addTrackRcMatch) {
        if (isVahanTrackedAnywhere(addTrackRcMatch[1])) {
          await message.reply(`Vahan tracking already exists for ${addTrackRcMatch[1]}.`);
          return;
        }

        const result = addVahanTrack(message.from, addTrackRcMatch[1], addTrackRcMatch[2], 'whatsapp');
        await message.reply(
          result.created
            ? `Vahan tracking added for ${addTrackRcMatch[1]}${addTrackRcMatch[2] ? ` - ${addTrackRcMatch[2].trim()}` : ''}.`
            : `Vahan tracking already exists for ${addTrackRcMatch[1]}.`
        );
        return;
      }

      if (removeTrackRcMatch) {
        const result = removeVahanTrackEverywhere(removeTrackRcMatch[1]);
        await message.reply(
          result.removed
            ? `Vahan tracking removed for ${removeTrackRcMatch[1]}.`
            : `No Vahan tracking entry found for ${removeTrackRcMatch[1]}.`
        );
        return;
      }

      if (trackRcMatch) {
        await message.reply('Fetching Vahan status...');
        await startVahanLookup(vahanWhatsAppClient, message.from, trackRcMatch[1], 'whatsapp');
        return;
      }

      if (/^stop$/i.test(normalizedBody) && hasActiveVahanSession(message.from, 'whatsapp')) {
        await stopVahanSession(message.from, 'whatsapp');
        await message.reply('Vahan session stopped.');
        return;
      }

      if (/^add\s+track$/i.test(normalizedBody)) {
        await startInteractiveAddTrackFlow(message);
        return;
      }

      if (addTrackMatch) {
        const explicitAppNo = addTrackMatch[1] || '';
        const explicitDob = normalizeDob(addTrackMatch[2] || '');
        const tag = addTrackMatch[3];
        let resolvedAppNo = explicitAppNo;
        let resolvedDob = explicitDob;

        if (!resolvedAppNo) {
          const extracted = await extractTrackInputFromMessage(message, normalizedBody.replace(/^add\s+track/i, '').trim());
          resolvedAppNo = extracted.appNo;
          resolvedDob = resolvedDob || extracted.dob;
        }

        await addTrackCommand(message, 'whatsapp', message.from, resolvedAppNo, tag, resolvedDob);
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
          {
            const inlineInput = extractAppNoAndDob(parts.slice(1).join(' '));
            const resolvedInput = inlineInput.appNo
              ? inlineInput
              : await extractTrackInputFromMessage(message, parts.slice(1).join(' '));

            if (!resolvedInput.appNo) {
              await message.reply('Usage: track <application_number> [dob]');
              break;
            }

            if (!resolvedInput.dob && !inlineInput.appNo && resolvedInput.rawValue) {
              await startPendingDobFlow(client, message, MessageMedia, resolvedInput.appNo);
              break;
            }

            clearPendingDobRequest(message.from);
            await trackCommand(client, message, MessageMedia, {
              appNo: resolvedInput.appNo,
              dob: resolvedInput.dob,
            });
          }
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
          if (hasActiveVahanSession(message.from, 'whatsapp')) {
            await handleVahanIncomingText(vahanWhatsAppClient, message.from, normalizedBody, 'whatsapp');
          }
          break;
      }
    } catch (error) {
      await message.reply('Something went wrong. Please try again later.');
    }
  }

  client.on('message', async (message) => {
    await handleMessage(message, 'message');
  });

  client.on('message_create', async (message) => {
    if (!message || !message.fromMe) {
      return;
    }

    await handleMessage(message, 'message_create');
  });

  await client.initialize();

  return client;
}

module.exports = {
  createBot,
};
