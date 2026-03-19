/**
 * Telegram bot bootstrap responsibility:
 * Initialize Telegram client and route incoming commands.
 */

const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { getAckPDF } = require('./services/ackService');
const { downloadForm } = require('./services/formService');
const { getFormset } = require('./services/formsetService');
const { getRandomAliveMeme } = require('./services/aliveService');
const {
  addAutoTrack,
  removeAutoTrack,
} = require('./services/autoTrackService');
const { setTelegramBot } = require('./services/chatNotifier');
const { isTgAuthorized } = require('./core/auth');
const CONFIG = require('./config/config');
const { getTrackingSnapshot } = require('./services/trackingSnapshotService');
const { normalizeDob } = require('./services/commandInputService');
const {
  buildTrackedItemsMessage,
  hasTrackedItems,
  isSarathiTrackedAnywhere,
  isVahanTrackedAnywhere,
  refreshAllTrackedApplications,
  removeVahanTrackEverywhere,
} = require('./services/trackingControlService');
const {
  addTrack: addVahanTrack,
  handleIncomingText: handleVahanIncomingText,
  hasActiveSession: hasActiveVahanSession,
  startLookup: startVahanLookup,
  startPolling: startVahanPolling,
  stopSession: stopVahanSession,
} = require('./services/vahanService');

let activeTelegramBot = null;
const vahanTelegramClient = {
  sendImage: async (chatId, imagePath, caption) => {
    await activeTelegramBot.sendPhoto(chatId, imagePath, { caption });
  },
  sendText: async (chatId, text) => {
    await activeTelegramBot.sendMessage(chatId, text);
  },
};

function parseArgs(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function getTelegramChatId(msg) {
  return String(msg && msg.chat && msg.chat.id || '').trim();
}

function getFirstAuthorizedChatId(config) {
  const security = (config && config.SECURITY) || {};
  const users = Array.isArray(security.AUTHORIZED_TG_USERS) ? security.AUTHORIZED_TG_USERS : [];
  const groups = Array.isArray(security.AUTHORIZED_TG_GROUPS) ? security.AUTHORIZED_TG_GROUPS : [];

  return users[0] || groups[0] || null;
}

function cleanupFile(filePath) {
  if (!filePath) {
    return;
  }

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function getTelegramConfig(config) {
  const source = (config && (config.TELEGRAM || config.telegram)) || {};
  const token = source.TOKEN || source.token || null;
  const polling = typeof source.POLLING === 'boolean' ? source.POLLING : source.polling !== false;

  return {
    token,
    polling,
  };
}

function buildHelpText() {
  return [
    'Available commands:',
    '/track <application_number> [dob]',
    '/addtrack <application_number> [dob] [-tag]',
    '/removetrack <application_number>',
    '/listtrack',
    '/refreshtrack',
    '/trackrc <application_number>',
    '/addtrackrc <application_number> [-tag]',
    '/removetrackrc <application_number>',
    '/stop',
    '/appl <application_number> <dob>',
    '/form1 <application_number> <dob>',
    '/form1a <application_number> <dob>',
    '/form2 <application_number> <dob>',
    '/formset <application_number> <dob>',
    '/alive',
    '/suno',
  ].join('\n');
}

async function startTelegramBot(config) {
  const telegramConfig = getTelegramConfig(config);

  if (!telegramConfig.token) {
    console.log('Telegram bot token not found. Skipping Telegram bot startup.');
    return null;
  }

  const bot = new TelegramBot(telegramConfig.token, {
    polling: telegramConfig.polling,
  });
  activeTelegramBot = bot;
  setTelegramBot(bot);
  startVahanPolling(vahanTelegramClient, 'telegram');

  bot.on('polling_error', (error) => {
    console.error(`Telegram polling error: ${error.message}`);
  });

  // Authorization check: only allow authorized users and groups
  bot.on('message', async (msg) => {
    if (!isTgAuthorized(msg, CONFIG)) {
      return; // Silently ignore unauthorized
    }

    const chatId = getTelegramChatId(msg);
    const text = String(msg && msg.text || '').trim();

    if (!text || text.startsWith('/')) {
      return;
    }

    if (/^list\s+track$/i.test(text)) {
      await bot.sendMessage(chatId, buildTrackedItemsMessage());
      return;
    }

    if (/^refresh\s+track$/i.test(text)) {
      if (!hasTrackedItems()) {
        await bot.sendMessage(chatId, 'No applications are being tracked.');
        return;
      }

      await refreshAllTrackedApplications();
      return;
    }

    const trackRcMatch = text.match(/^track\s+rc\s+([A-Z0-9]+)$/i);
    if (trackRcMatch) {
      await bot.sendMessage(chatId, 'Fetching Vahan status...');
      await startVahanLookup(vahanTelegramClient, chatId, trackRcMatch[1], 'telegram');
      return;
    }

    const addTrackRcMatch = text.match(/^add\s+track\s+rc\s+([A-Z0-9]+)(?:\s*-\s*(.+))?$/i);
    if (addTrackRcMatch) {
      if (isVahanTrackedAnywhere(addTrackRcMatch[1])) {
        await bot.sendMessage(chatId, `Vahan tracking already exists for ${addTrackRcMatch[1]}.`);
        return;
      }

      const result = addVahanTrack(chatId, addTrackRcMatch[1], addTrackRcMatch[2], 'telegram');
      await bot.sendMessage(
        chatId,
        result.created
          ? `Vahan tracking added for ${addTrackRcMatch[1]}${addTrackRcMatch[2] ? ` - ${addTrackRcMatch[2].trim()}` : ''}.`
          : `Vahan tracking already exists for ${addTrackRcMatch[1]}.`
      );
      return;
    }

    const removeTrackRcMatch = text.match(/^remove\s+track\s+rc\s+([A-Z0-9]+)$/i);
    if (removeTrackRcMatch) {
      const result = removeVahanTrackEverywhere(removeTrackRcMatch[1]);
      await bot.sendMessage(
        chatId,
        result.removed
          ? `Vahan tracking removed for ${removeTrackRcMatch[1]}.`
          : `No Vahan tracking entry found for ${removeTrackRcMatch[1]}.`
      );
      return;
    }

    if (/^stop$/i.test(text) && hasActiveVahanSession(chatId, 'telegram')) {
      await stopVahanSession(chatId, 'telegram');
      await bot.sendMessage(chatId, 'Vahan session stopped.');
      return;
    }

    if (hasActiveVahanSession(chatId, 'telegram')) {
      await handleVahanIncomingText(vahanTelegramClient, chatId, text, 'telegram');
    }
  });

  bot.onText(/^\/start(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    console.log(`[telegram] /start chat=${chatId}`);
    await bot.sendMessage(
      chatId,
      'Welcome to Sarathi Bot.\nUse /help to see supported commands.'
    );
  });

  bot.onText(/^\/help(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    console.log(`[telegram] /help chat=${chatId}`);
    await bot.sendMessage(chatId, buildHelpText());
  });

  bot.onText(/^\/track(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    console.log(`[telegram] /track chat=${chatId}`);

    if (!appNo) {
      await bot.sendMessage(chatId, 'Usage: /track <application_number> [dob]');
      return;
    }

    let filePath;
    try {
      await bot.sendMessage(chatId, 'Fetching status...');
      const snapshot = await getTrackingSnapshot(appNo, dob, {
        keepFile: true,
        filename: `Track_${appNo}.jpg`,
      });
      filePath = snapshot.filePath;
      await bot.sendPhoto(chatId, filePath);
    } catch (error) {
      await bot.sendMessage(chatId, 'Not Found');
    } finally {
      cleanupFile(filePath);
    }
  });

  bot.onText(/^\/(?:alive|suno)(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    console.log(`[telegram] /alive chat=${chatId}`);

    try {
      const meme = getRandomAliveMeme();
      await bot.sendAnimation(chatId, meme.url, {
        caption: meme.caption,
      });
    } catch (error) {
      await bot.sendMessage(chatId, 'Bot is alive, but the meme could not be loaded right now.');
    }
  });

  bot.onText(/^\/appl(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = args[1];
    console.log(`[telegram] /appl chat=${chatId}`);

    if (!appNo || !dob) {
      await bot.sendMessage(chatId, 'Usage: /appl <application_number> <dob>');
      return;
    }

    let filePath;
    try {
      await bot.sendMessage(chatId, 'Fetching receipt...');
      filePath = await getAckPDF(appNo, dob);
      await bot.sendDocument(chatId, filePath);
    } catch (error) {
      await bot.sendMessage(
        chatId,
        'Failed to fetch receipt. Check DOB or application number.'
      );
    } finally {
      cleanupFile(filePath);
    }
  });

  bot.onText(/^\/addtrack(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    const raw = String(match && match[1] || '').trim();
    const parsed = raw.match(/^(\d+)(?:\s+(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}))?(?:\s*-\s*(.+))?$/i);
    console.log(`[telegram] /addtrack chat=${chatId}`);

    if (!parsed) {
      await bot.sendMessage(chatId, 'Usage: /addtrack <application_number> [dob] [-tag]');
      return;
    }

    const appNo = parsed[1];
    const dob = normalizeDob(parsed[2] || '');
    const tag = String(parsed[3] || '').trim();

    if (isSarathiTrackedAnywhere(appNo)) {
      await bot.sendMessage(chatId, `Application ${appNo} is already being tracked.`);
      return;
    }

    const result = addAutoTrack({
      appNo,
      transport: 'telegram',
      chatId,
      dob,
      tag,
    });

    await bot.sendMessage(
      chatId,
      result.created
        ? `Auto-tracking started for ${appNo}${tag ? ` - ${tag}` : ''}. I will notify you when it is approved.`
        : `Application ${appNo} is already being tracked here.`
    );
  });

  bot.onText(/^\/listtrack(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = getTelegramChatId(msg);
    await bot.sendMessage(chatId, buildTrackedItemsMessage());
  });

  bot.onText(/^\/refreshtrack(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = getTelegramChatId(msg);
    if (!hasTrackedItems()) {
      await bot.sendMessage(chatId, 'No applications are being tracked.');
      return;
    }

    await refreshAllTrackedApplications();
  });

  bot.onText(/^\/trackrc(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = getTelegramChatId(msg);
    const appNo = parseArgs(match && match[1])[0];

    if (!appNo) {
      await bot.sendMessage(chatId, 'Usage: /trackrc <application_number>');
      return;
    }

    await bot.sendMessage(chatId, 'Fetching Vahan status...');
    await startVahanLookup(vahanTelegramClient, chatId, appNo, 'telegram');
  });

  bot.onText(/^\/addtrackrc(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = getTelegramChatId(msg);
    const raw = String(match && match[1] || '').trim();
    const parsed = raw.match(/^([A-Z0-9]+)(?:\s*-\s*(.+))?$/i);

    if (!parsed) {
      await bot.sendMessage(chatId, 'Usage: /addtrackrc <application_number> [-tag]');
      return;
    }

    if (isVahanTrackedAnywhere(parsed[1])) {
      await bot.sendMessage(chatId, `Vahan tracking already exists for ${parsed[1]}.`);
      return;
    }

    const result = addVahanTrack(chatId, parsed[1], parsed[2], 'telegram');
    await bot.sendMessage(
      chatId,
      result.created
        ? `Vahan tracking added for ${parsed[1]}${parsed[2] ? ` - ${parsed[2].trim()}` : ''}.`
        : `Vahan tracking already exists for ${parsed[1]}.`
    );
  });

  bot.onText(/^\/removetrackrc(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = getTelegramChatId(msg);
    const appNo = parseArgs(match && match[1])[0];

    if (!appNo) {
      await bot.sendMessage(chatId, 'Usage: /removetrackrc <application_number>');
      return;
    }

    const result = removeVahanTrackEverywhere(appNo);
    await bot.sendMessage(
      chatId,
      result.removed
        ? `Vahan tracking removed for ${appNo}.`
        : `No Vahan tracking entry found for ${appNo}.`
    );
  });

  bot.onText(/^\/stop(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = getTelegramChatId(msg);

    if (!hasActiveVahanSession(chatId, 'telegram')) {
      await bot.sendMessage(chatId, 'No active Vahan session is running.');
      return;
    }

    await stopVahanSession(chatId, 'telegram');
    await bot.sendMessage(chatId, 'Vahan session stopped.');
  });

  bot.onText(/^\/removetrack(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    const appNo = parseArgs(match && match[1])[0];
    console.log(`[telegram] /removetrack chat=${chatId}`);

    if (!appNo) {
      await bot.sendMessage(chatId, 'Usage: /removetrack <application_number>');
      return;
    }

    const result = removeAutoTrack({
      appNo,
      transport: 'telegram',
      chatId,
    });

    await bot.sendMessage(
      chatId,
      result.removed
        ? `Auto-tracking removed for ${appNo}.`
        : `No active auto-tracking entry found for ${appNo}.`
    );
  });

  bot.onText(/^\/form1(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = args[1];
    console.log(`[telegram] /form1 chat=${chatId}`);

    if (!appNo || !dob) {
      await bot.sendMessage(chatId, 'Usage: /form1 <application_number> <dob>');
      return;
    }

    let filePath;
    try {
      await bot.sendMessage(chatId, 'Fetching form1 PDF...');
      filePath = await downloadForm(appNo, dob, 'form1');
      await bot.sendDocument(chatId, filePath);
    } catch (error) {
      await bot.sendMessage(
        chatId,
        'Failed to fetch Form 1. Check application number and DOB format.'
      );
    } finally {
      cleanupFile(filePath);
    }
  });

  bot.onText(/^\/form1a(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = args[1];
    console.log(`[telegram] /form1a chat=${chatId}`);

    if (!appNo || !dob) {
      await bot.sendMessage(chatId, 'Usage: /form1a <application_number> <dob>');
      return;
    }

    let filePath;
    try {
      await bot.sendMessage(chatId, 'Fetching form1a PDF...');
      filePath = await downloadForm(appNo, dob, 'form1a');
      await bot.sendDocument(chatId, filePath);
    } catch (error) {
      await bot.sendMessage(
        chatId,
        'Failed to fetch Form 1A. Check application number and DOB format.'
      );
    } finally {
      cleanupFile(filePath);
    }
  });

  bot.onText(/^\/form2(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = args[1];
    console.log(`[telegram] /form2 chat=${chatId}`);

    if (!appNo || !dob) {
      await bot.sendMessage(chatId, 'Usage: /form2 <application_number> <dob>');
      return;
    }

    let filePath;
    try {
      await bot.sendMessage(chatId, 'Fetching form2 PDF...');
      filePath = await downloadForm(appNo, dob, 'form2');
      await bot.sendDocument(chatId, filePath);
    } catch (error) {
      await bot.sendMessage(
        chatId,
        'Failed to fetch Form 2. Check application number and DOB format.'
      );
    } finally {
      cleanupFile(filePath);
    }
  });

  bot.onText(/^\/formset(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!isTgAuthorized(msg, CONFIG)) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = args[1];
    console.log(`[telegram] /formset chat=${chatId}`);

    if (!appNo || !dob) {
      await bot.sendMessage(chatId, 'Usage: /formset <application_number> <dob>');
      return;
    }

    try {
      await bot.sendMessage(chatId, 'Building formset PDF...');
      const { buffer, filename } = await getFormset(appNo, dob);
      await bot.sendDocument(
        chatId,
        buffer,
        {},
        {
          filename,
          contentType: 'application/pdf',
        }
      );
    } catch (error) {
      await bot.sendMessage(
        chatId,
        'Failed to build formset PDF. Check the application number and DOB.'
      );
    }
  });

  console.log('Telegram bot started.');
  return bot;
}

async function notifyFirstAuthorizedChat(config, text) {
  const telegramConfig = getTelegramConfig(config || CONFIG);
  const chatId = getFirstAuthorizedChatId(config || CONFIG);
  const message = String(text || '').trim();

  if (!telegramConfig.token || !chatId || !message) {
    return false;
  }

  if (activeTelegramBot) {
    await activeTelegramBot.sendMessage(chatId, message);
    return true;
  }

  const apiUrl = `https://api.telegram.org/bot${telegramConfig.token}/sendMessage`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Telegram notification failed (${response.status}): ${bodyText.slice(0, 500)}`);
  }

  return true;
}

module.exports = {
  startTelegramBot,
  notifyFirstAuthorizedChat,
};
