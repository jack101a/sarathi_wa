/**
 * Telegram bot bootstrap responsibility:
 * Initialize Telegram client and route incoming commands.
 */

const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { getVisualStatus } = require('./services/statusService');
const { getAckPDF } = require('./services/ackService');
const { downloadForm } = require('./services/formService');
const { getFormset } = require('./services/formsetService');
const { getRandomAliveMeme } = require('./services/aliveService');
const { addAutoTrack, removeAutoTrack } = require('./services/autoTrackService');
const { setTelegramBot } = require('./services/chatNotifier');
const { isTgAuthorized } = require('./core/auth');
const CONFIG = require('./config/config');

let activeTelegramBot = null;

function parseArgs(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
    '/track <application_number>',
    '/addtrack <application_number>',
    '/removetrack <application_number>',
    '/appl <application_number> <dob>',
    '/form1 <application_number> <dob>',
    '/form1a <application_number> <dob>',
    '/form2 <application_number> <dob>',
    '/formset <application_number> <dob>',
    '/alive',
    '/suno',
    '',
    'Vahan RC captcha workflow is currently available on WhatsApp only:',
    'track rc <application_number>',
    'add track rc <application_number> -tag',
    'remove track rc <application_number>',
    'list track',
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

  bot.on('polling_error', (error) => {
    console.error(`Telegram polling error: ${error.message}`);
  });

  // Authorization check: only allow authorized users and groups
  bot.on('message', (msg) => {
    if (!isTgAuthorized(msg, CONFIG)) {
      return; // Silently ignore unauthorized
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
    console.log(`[telegram] /track chat=${chatId}`);

    if (!appNo) {
      await bot.sendMessage(chatId, 'Usage: /track <application_number>');
      return;
    }

    let filePath;
    try {
      await bot.sendMessage(chatId, 'Fetching status...');
      filePath = await getVisualStatus(appNo);
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
    const appNo = parseArgs(match && match[1])[0];
    console.log(`[telegram] /addtrack chat=${chatId}`);

    if (!appNo) {
      await bot.sendMessage(chatId, 'Usage: /addtrack <application_number>');
      return;
    }

    const result = addAutoTrack({
      appNo,
      transport: 'telegram',
      chatId,
    });

    await bot.sendMessage(
      chatId,
      result.created
        ? `Auto-tracking started for ${appNo}. I will notify you when it is approved.`
        : `Application ${appNo} is already being tracked here.`
    );
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
