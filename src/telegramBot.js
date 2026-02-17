/**
 * Telegram bot bootstrap responsibility:
 * Initialize Telegram client and route incoming commands.
 */

const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { getVisualStatus } = require('./services/statusService');
const { getAckPDF } = require('./services/ackService');
const { downloadForm } = require('./services/formService');

function parseArgs(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
    '/appl <application_number> <dob>',
    '/form1 <application_number> <dob>',
    '/form1a <application_number> <dob>',
    '/form2 <application_number> <dob>',
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

  bot.on('polling_error', (error) => {
    console.error(`Telegram polling error: ${error.message}`);
  });

  bot.onText(/^\/start(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[telegram] /start chat=${chatId}`);
    await bot.sendMessage(
      chatId,
      'Welcome to Sarathi Bot.\nUse /help to see supported commands.'
    );
  });

  bot.onText(/^\/help(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`[telegram] /help chat=${chatId}`);
    await bot.sendMessage(chatId, buildHelpText());
  });

  bot.onText(/^\/track(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
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

  bot.onText(/^\/appl(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
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

  bot.onText(/^\/form1(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
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

  console.log('Telegram bot started.');
  return bot;
}

module.exports = {
  startTelegramBot,
};
