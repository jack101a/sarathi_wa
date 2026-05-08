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
  clearRcReceiptTrackingCandidate,
  clearReceiptTrackingCandidate,
  extractRcReceiptTrackingCandidate,
  extractReceiptTrackingCandidate,
  getRcReceiptTrackingCandidate,
  getReceiptTrackingCandidate,
  setRcReceiptTrackingCandidate,
  setReceiptTrackingCandidate,
} = require('./services/receiptInputService');
const {
  buildTrackedItemsMessage,
  hasTrackedItems,
  isVahanTrackedAnywhere,
  refreshAllTrackedApplications,
  removeVahanTrackEverywhere,
} = require('./services/trackingControlService');
const { submitLLPrintOTP } = require('./services/llPrintService');
const { getLlprintSessions } = require('./workers/browserWorker');
const fs = require('fs');

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

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
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
      const result = await addVahanTrack(message.from, flow.data.appNo, tag, 'whatsapp');
      if (result.error === 'LIMIT_REACHED') {
        await message.reply('You have reached the maximum tracking limit (10). Unable to add new application as none could be safely removed.');
        return true;
      }
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
    const receiptCandidate = await extractReceiptTrackingCandidate(ownMedia.buffer, ownMedia.mimeType);
    if (receiptCandidate && receiptCandidate.appNo) {
      return {
        appNo: receiptCandidate.appNo,
        dob: receiptCandidate.dob || '',
        sourceText: 'media receipt',
        rawValue: receiptCandidate.rawValue || 'media-receipt',
        name: receiptCandidate.name || '',
      };
    }

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
        const quotedReceiptCandidate = await extractReceiptTrackingCandidate(
          quotedMedia.buffer,
          quotedMedia.mimeType
        );
        if (quotedReceiptCandidate && quotedReceiptCandidate.appNo) {
          return {
            appNo: quotedReceiptCandidate.appNo,
            dob: quotedReceiptCandidate.dob || '',
            sourceText: 'quoted media receipt',
            rawValue: quotedReceiptCandidate.rawValue || 'quoted-media-receipt',
            name: quotedReceiptCandidate.name || '',
          };
        }

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

  const cachedCandidate = getReceiptTrackingCandidate(message.from);
  if (cachedCandidate && cachedCandidate.appNo) {
    return {
      appNo: cachedCandidate.appNo,
      dob: cachedCandidate.dob || '',
      sourceText: 'cached receipt',
      rawValue: 'cached-receipt',
      fromReceiptCache: true,
      name: cachedCandidate.name || '',
    };
  }

  return {
    appNo: '',
    dob: '',
    sourceText: '',
  };
}

async function extractRcTrackInputFromMessage(message, fallbackCommandText = '') {
  const fallbackMatch = normalizeText(fallbackCommandText).match(/\b([A-Z]{2}[A-Z0-9]{8,22})\b/i);
  if (fallbackMatch) {
    return {
      appNo: fallbackMatch[1].toUpperCase(),
      vehicleNo: '',
    };
  }

  const ownTextMatch = normalizeText(message.body || '').match(/\b([A-Z]{2}[A-Z0-9]{8,22})\b/i);
  if (ownTextMatch) {
    return {
      appNo: ownTextMatch[1].toUpperCase(),
      vehicleNo: '',
    };
  }

  const ownMedia = await downloadMediaInput(message);
  if (ownMedia) {
    const ownCandidate = await extractRcReceiptTrackingCandidate(ownMedia.buffer, ownMedia.mimeType);
    if (ownCandidate && ownCandidate.appNo) {
      return {
        appNo: ownCandidate.appNo,
        vehicleNo: ownCandidate.vehicleNo || '',
      };
    }
  }

  if (message.hasQuotedMsg && typeof message.getQuotedMessage === 'function') {
    const quotedMessage = await message.getQuotedMessage();
    if (quotedMessage) {
      const quotedTextMatch = normalizeText(quotedMessage.body || '').match(/\b([A-Z]{2}[A-Z0-9]{8,22})\b/i);
      if (quotedTextMatch) {
        return {
          appNo: quotedTextMatch[1].toUpperCase(),
          vehicleNo: '',
        };
      }

      const quotedMedia = await downloadMediaInput(quotedMessage);
      if (quotedMedia) {
        const quotedCandidate = await extractRcReceiptTrackingCandidate(
          quotedMedia.buffer,
          quotedMedia.mimeType
        );
        if (quotedCandidate && quotedCandidate.appNo) {
          return {
            appNo: quotedCandidate.appNo,
            vehicleNo: quotedCandidate.vehicleNo || '',
          };
        }
      }
    }
  }

  const cached = getRcReceiptTrackingCandidate(message.from);
  if (cached && cached.appNo) {
    return {
      appNo: cached.appNo,
      vehicleNo: cached.vehicleNo || '',
      fromReceiptCache: true,
    };
  }

  return {
    appNo: '',
    vehicleNo: '',
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
    const llprintSessions = getLlprintSessions();

    async function enqueueOrReply(messageObj, transport, commandInfo) {
      const { processRequest } = require('./core/requestPipeline');
      const result = await processRequest(messageObj, transport, commandInfo);
      if (result.blocked) {
        await messageObj.reply(`? ${result.message}`);
        return false;
      }
      await messageObj.reply('? Processing...');
      return true;
    }

    console.log(`[whatsapp] Message received from ${message.from} in event '${eventName}': "${normalizedBody}"`);

    if (isChatIdCommand(normalizedBody)) {
      await message.reply(getChatIdReplyText(message));
      return;
    }

    if (/^auth\s+\d+\s+[a-z0-9]{6}$/i.test(normalizedBody)) {
      const { consumeVerificationMessage } = require('./services/waVerificationService');
      const { extractIdentityFromMessage } = require('./services/authorizationNormalizer');
      const idContext = extractIdentityFromMessage(message);
      const ok = await consumeVerificationMessage(normalizedBody, idContext);
      if (ok) {
        await message.reply('Verification successful! You are now authorized.');
        return;
      }
    }

    if (!(await isAuthorized(message, CONFIG))) {
      console.log(`[whatsapp] Unauthorized message from ${message.from} blocked.`);
      return;
    }

    if (/^\/?auth\b/i.test(normalizedBody)) {
      const { isAdminWhatsApp } = require('./services/authorizationService');
      const { handleAuthCommand } = require('./commands/authAdmin');
      if (!isAdminWhatsApp(message, CONFIG)) {
        await message.reply('Access denied. Admin only.');
        return;
      }
      const reply = await handleAuthCommand(normalizedBody, message.from, client);
      if (reply) {
        await message.reply(reply);
        return;
      }
    }

    const parts = (message.body || '').trim().split(/\s+/);
    const command = (parts[0] || '').toLowerCase();
    const addTrackMatch = normalizedBody.match(/^add\s+track(?:\s+(\d+))?(?:\s+(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}))?(?:\s*-\s*(.+))?$/i);
    const removeTrackMatch = normalizedBody.match(/^remove\s+track\s+(\d+)$/i);
    const addTrackRcMatch = normalizedBody.match(/^add\s+track\s+rc(?:\s+([A-Z0-9]+))?(?:\s*-\s*(.+))?$/i);
    const removeTrackRcMatch = normalizedBody.match(/^remove\s+track\s+rc\s+([A-Z0-9]+)$/i);
    const trackRcMatch = normalizedBody.match(/^track\s+rc(?:\s+([A-Z0-9]+))?$/i);

    try {
      if (CONFIG.AUTO_TRACK.UPDATE_CHAT_ID && message.from === CONFIG.AUTO_TRACK.UPDATE_CHAT_ID) {
        return;
      }

      if (await handleInteractiveAddTrackFlow(message)) {
        return;
      }

      if (llprintSessions.has(message.from) && !normalizedBody.startsWith('/llprint')) {
        const flow = llprintSessions.get(message.from);
        const otpCode = normalizedBody.trim();
        if (otpCode.length > 0 && otpCode.length <= 8) {
          llprintSessions.delete(message.from);
          try {
            const pdfPath = await submitLLPrintOTP(flow.context, flow.page, otpCode, flow.appNo, flow.dob);
            const media = MessageMedia.fromFilePath(pdfPath);
            await client.sendMessage(message.from, media);
            if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
          } catch (error) {
            await message.reply('Failed to download Learner Licence or OTP was incorrect.');
            if (flow.context) await flow.context.close().catch(() => {});
          }
          return;
        }
      }

      const pendingDob = pendingDobRequests.get(message.from);
      if (pendingDob && !/^track\b/i.test(normalizedBody)) {
        const suppliedDob = normalizeDob(normalizedBody);
        if (suppliedDob) {
          clearPendingDobRequest(message.from);
          await enqueueOrReply(message, 'whatsapp', { command: 'track', payload: { appNo: pendingDob.appNo, dob: suppliedDob }, chatId: message.from });
          return;
        }
      }

      if (message.hasMedia) {
        const mediaInput = await downloadMediaInput(message);
        if (mediaInput && /^image\//i.test(mediaInput.mimeType)) {
          const [dlCandidate, rcCandidate] = await Promise.all([
            extractReceiptTrackingCandidate(mediaInput.buffer, mediaInput.mimeType),
            extractRcReceiptTrackingCandidate(mediaInput.buffer, mediaInput.mimeType),
          ]);
          setReceiptTrackingCandidate(message.from, dlCandidate);
          setRcReceiptTrackingCandidate(message.from, rcCandidate);
        }
      }

      if (/^help$/i.test(normalizedBody)) {
        await message.reply(getHelpText());
        return;
      }

      if (/^\/?llprint(?:\s+.*)?$/i.test(normalizedBody)) {
        const llArgs = normalizedBody.split(/\s+/).slice(1);
        const appNo = llArgs[0];
        const dob = normalizeDob(llArgs[1] || '');
        if (!appNo || !dob) {
          await message.reply('Usage: /llprint <application_number> <dob>');
          return;
        }
        const senderPhone = (message.from || '').split('@')[0];
        const mobile = senderPhone.length > 10 ? senderPhone.slice(-10) : senderPhone;
        await enqueueOrReply(message, 'whatsapp', { command: 'llprint_start', payload: { appNo, dob, mobile }, chatId: message.from });
        return;
      }

      if (/^list\s+track$/i.test(normalizedBody)) {
        await enqueueOrReply(message, 'whatsapp', { command: 'list_track', payload: {}, chatId: message.from });
        return;
      }

      if (/^track\s+status$/i.test(normalizedBody)) {
        await enqueueOrReply(message, 'whatsapp', { command: 'track_status', payload: {}, chatId: message.from });
        return;
      }

      if (/^refresh\s+track$/i.test(normalizedBody)) {
        await enqueueOrReply(message, 'whatsapp', { command: 'refresh_track', payload: {}, chatId: message.from });
        return;
      }

      if (addTrackRcMatch) {
        const extractedRc = await extractRcTrackInputFromMessage(message, addTrackRcMatch[1] || '');
        const rcAppNo = (addTrackRcMatch[1] || '').toUpperCase() || extractedRc.appNo || '';
        const tagValue = addTrackRcMatch[2] || '';
        if (!rcAppNo) {
          await message.reply('Usage: add track rc <application_number> -tag');
          return;
        }
        if (!addTrackRcMatch[1] || extractedRc.fromReceiptCache) clearRcReceiptTrackingCandidate(message.from);
        await enqueueOrReply(message, 'whatsapp', { command: 'add_track_rc', payload: { appNo: rcAppNo, tag: tagValue, vehicleNo: extractedRc.vehicleNo || '' }, chatId: message.from });
        return;
      }

      if (removeTrackRcMatch) {
        await enqueueOrReply(message, 'whatsapp', { command: 'remove_track_rc', payload: { appNo: removeTrackRcMatch[1] }, chatId: message.from });
        return;
      }

      if (trackRcMatch) {
        const extractedRc = await extractRcTrackInputFromMessage(message, trackRcMatch[1] || '');
        const rcAppNo = (trackRcMatch[1] || '').toUpperCase() || extractedRc.appNo || '';
        if (!rcAppNo) {
          await message.reply('Usage: track rc <application_number>');
          return;
        }
        if (!trackRcMatch[1] || extractedRc.fromReceiptCache) clearRcReceiptTrackingCandidate(message.from);
        await enqueueOrReply(message, 'whatsapp', { command: 'track_rc', payload: { appNo: rcAppNo, vehicleNo: extractedRc.vehicleNo || '' }, chatId: message.from });
        return;
      }

      if (/^stop$/i.test(normalizedBody) && hasActiveVahanSession(message.from, 'whatsapp')) {
        await stopVahanSession(message.from, 'whatsapp');
        await message.reply('Vahan session stopped.');
        return;
      }

      if (/^add\s+track$/i.test(normalizedBody)) {
        const extracted = await extractTrackInputFromMessage(message);
        if (extracted.appNo) {
          if (extracted.fromReceiptCache) clearReceiptTrackingCandidate(message.from);
          await enqueueOrReply(message, 'whatsapp', { command: 'add_track', payload: { appNo: extracted.appNo, dob: extracted.dob || '', tag: '' }, chatId: message.from });
          return;
        }
        await startInteractiveAddTrackFlow(message);
        return;
      }

      if (addTrackMatch) {
        const explicitAppNo = addTrackMatch[1] || '';
        const explicitDob = normalizeDob(addTrackMatch[2] || '');
        const tag = addTrackMatch[3] || '';
        let resolvedAppNo = explicitAppNo;
        let resolvedDob = explicitDob;
        if (!resolvedAppNo) {
          const extracted = await extractTrackInputFromMessage(message, normalizedBody.replace(/^add\s+track/i, '').trim());
          resolvedAppNo = extracted.appNo;
          resolvedDob = resolvedDob || extracted.dob;
          if (extracted.fromReceiptCache) clearReceiptTrackingCandidate(message.from);
        }
        if (!resolvedAppNo) {
          await message.reply('Could not determine application number.');
          return;
        }
        await enqueueOrReply(message, 'whatsapp', { command: 'add_track', payload: { appNo: resolvedAppNo, dob: resolvedDob, tag }, chatId: message.from });
        return;
      }

      if (removeTrackMatch) {
        await enqueueOrReply(message, 'whatsapp', { command: 'remove_track', payload: { appNo: removeTrackMatch[1] }, chatId: message.from });
        return;
      }

      switch (command) {
        case 'suno':
        case 'alive':
          await aliveCommand(client, message, MessageMedia);
          break;
        case 'track': {
          const inlineInput = extractAppNoAndDob(parts.slice(1).join(' '));
          const resolvedInput = inlineInput.appNo ? inlineInput : await extractTrackInputFromMessage(message, parts.slice(1).join(' '));
          if (!resolvedInput.appNo) {
            await message.reply('Usage: track <application_number> [dob]');
            break;
          }
          if (!resolvedInput.dob && !inlineInput.appNo && resolvedInput.rawValue) {
            await startPendingDobFlow(client, message, MessageMedia, resolvedInput.appNo);
            break;
          }
          clearPendingDobRequest(message.from);
          if (resolvedInput.fromReceiptCache) clearReceiptTrackingCandidate(message.from);
          await enqueueOrReply(message, 'whatsapp', { command: 'track', payload: { appNo: resolvedInput.appNo, dob: resolvedInput.dob || '' }, chatId: message.from });
          break;
        }
        case 'appl': {
          const args = parts.slice(1);
          const appNo = args[0] || '';
          const dob = normalizeDob(args[1] || '');
          if (!appNo || !dob) { await message.reply('Usage: appl <application_number> <dob>'); break; }
          await enqueueOrReply(message, 'whatsapp', { command: 'appl_image', payload: { appNo, dob }, chatId: message.from });
          break;
        }
        case 'form1':
        case 'form1a':
        case 'form2': {
          const args = parts.slice(1);
          const appNo = args[0] || '';
          const dob = normalizeDob(args[1] || '');
          if (!appNo || !dob) { await message.reply(`Usage: ${command} <application_number> <dob>`); break; }
          await enqueueOrReply(message, 'whatsapp', { command, payload: { appNo, dob }, chatId: message.from });
          break;
        }
        case 'formset': {
          const args = parts.slice(1);
          const appNo = args[0] || '';
          const dob = normalizeDob(args[1] || '');
          if (!appNo || !dob) { await message.reply('Usage: formset <application_number> <dob>'); break; }
          await enqueueOrReply(message, 'whatsapp', { command: 'formset', payload: { appNo, dob }, chatId: message.from });
          break;
        }
        default:
          if (hasActiveVahanSession(message.from, 'whatsapp')) {
            if (!normalizedBody && message.hasMedia) break;
            await handleVahanIncomingText(vahanWhatsAppClient, message.from, normalizedBody, 'whatsapp');
          }
          break;
      }
    } catch (error) {
      await message.reply('Something went wrong. Please try again later.');
    }
  }  const sentMessageIds = new Map(); // id → timestamp

  // Prune entries older than 60 seconds every 30 seconds
  const _sentIdsCleanup = setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [id, ts] of sentMessageIds) {
      if (ts < cutoff) sentMessageIds.delete(id);
    }
  }, 30_000);
  _sentIdsCleanup.unref(); // don't keep process alive just for this

  const originalSendMessage = client.sendMessage.bind(client);
  client.sendMessage = async function(chatId, content, options) {
    const result = await originalSendMessage(chatId, content, options);
    if (result && result.id && result.id.id) {
      sentMessageIds.set(result.id.id, Date.now());
    }
    return result;
  };

  client.on('message_create', async (message) => {
    if (!message) {
      return;
    }

    // Allow self-issued command messages, but ignore self echo chatter/status texts.
    if (message.fromMe) {
      const ownBody = normalizeText(message.body || '');
      const looksLikeCommand = /^(help|track|add|remove|refresh|list|alive|suno|appl|form1|form1a|form2|formset|stop|auth|\/?llprint|\/?send(?:_|\s+)chatid)\b/i.test(ownBody);
      if (!looksLikeCommand) {
        return;
      }
    }

    if (message.id && message.id.id && sentMessageIds.has(message.id.id)) {
      sentMessageIds.delete(message.id.id);
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



