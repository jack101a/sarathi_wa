/**
 * Telegram bot bootstrap responsibility:
 * Initialize Telegram client and route incoming commands.
 */

const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const { getRandomAliveMeme } = require('./services/aliveService');
const {
  addAutoTrack,
  removeAutoTrack,
} = require('./services/autoTrackService');
const { setTelegramBot } = require('./services/chatNotifier');
const { isTgAuthorized } = require('./core/auth');
const CONFIG = require('./config/config');

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
const { submitLLPrintOTP } = require('./services/llPrintService');
const { submitLLEditOTP } = require('./services/llEditService');
const { getLlprintSessions, getLleditSessions } = require('./workers/browserWorker');

let activeTelegramBot = null;
const activeLLPrintFlows = new Map();
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

  const { readStore } = require('./services/authorizationStore');
  const store = readStore();
  const storeUsers = store.telegram.users || [];
  const storeGroups = store.telegram.groups || [];

  return users[0] || storeUsers[0] || groups[0] || storeGroups[0] || null;
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
    '/llprint <application_number> <dob> [10_digit_mobile]',
    '/lledit <application_number> <dob> [10_digit_mobile]',
    '/dlrenewal <DL_number> <dob> [RTO_code] [10_digit_mobile]',
    '/applydl <LL_number> <dob> [10_digit_mobile]',
    '/payfee <application_number> <dob>',
    '/feeprint <application_number> <dob>',
    '/bookslot <application_number> <dob>',
    '/resend <application_number>',
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

  const bot = new TelegramBot(telegramConfig.token, { polling: telegramConfig.polling });
  activeTelegramBot = bot;
  setTelegramBot(bot);
  startVahanPolling(vahanTelegramClient, 'telegram');

  async function enqueueOrReplyTg(botClient, msg, commandInfo) {
    const { processRequest } = require('./core/requestPipeline');
    const result = await processRequest(msg, 'telegram', commandInfo);
    if (result.blocked) {
      await botClient.sendMessage(msg.chat.id, `🚫 ${result.message}`);
      return false;
    }
    await botClient.sendMessage(msg.chat.id, '⏳ Processing...');
    return true;
  }

  bot.on('polling_error', (error) => {
    console.error(`Telegram polling error: ${error.message}`);
  });

  bot.on('message', async (msg) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;

    const chatId = getTelegramChatId(msg);
    const text = String((msg && msg.text) || '').trim();
    if (CONFIG.DAILY_FILLING.ENABLED) {
      const dailyFillingRouter = require('./services/dailyFillingRouter');
      if (await dailyFillingRouter.handleDailyFillingTelegramMessage(msg, bot, enqueueOrReplyTg)) {
        return;
      }
    }

    if (/^\/?auth\b/i.test(text)) {
      const { isAdminTelegram } = require('./services/authorizationService');
      const { handleAuthCommand } = require('./commands/authAdmin');
      if (!isAdminTelegram(msg, CONFIG)) {
        await bot.sendMessage(chatId, 'Access denied. Admin only.');
        return;
      }
      const reply = await handleAuthCommand(text, chatId);
      if (reply) {
        await bot.sendMessage(chatId, reply);
        return;
      }
    }

    if (!text || text.startsWith('/')) return;

    const llprintSessions = getLlprintSessions();
    if (llprintSessions.has(chatId) && !text.startsWith('/llprint')) {
      const flow = llprintSessions.get(chatId);
      const otpCode = text.trim();
      if (otpCode.length > 0 && otpCode.length <= 8) {
        llprintSessions.delete(chatId);
        try {
          const pdfPath = await submitLLPrintOTP(flow.context, flow.page, otpCode, flow.appNo, flow.dob);
          await bot.sendDocument(chatId, pdfPath);
          cleanupFile(pdfPath);
        } catch (error) {
          await bot.sendMessage(chatId, 'Failed to download Learner Licence or OTP was incorrect.');
          if (flow.context) await flow.context.close().catch(() => {});
        }
        return;
      }
    }

    const lleditSessions = getLleditSessions();
    if (lleditSessions.has(chatId) && !text.startsWith('/lledit')) {
      const flow = lleditSessions.get(chatId);
      const otpCode = text.trim();
      if (otpCode.length > 0 && otpCode.length <= 8) {
        lleditSessions.delete(chatId);
        try {
          await bot.sendMessage(chatId, '⏳ OTP received. Processing dynamic form filling and priming...');
          await submitLLEditOTP(flow.context, flow.page, otpCode, flow.targetAppNo, flow.targetDob, flow.dynamicData);
          await bot.sendMessage(chatId, '✅ Bait-and-Switch successfully completed! Application updated and session primed.');
        } catch (error) {
          console.error('lledit error:', error);
          await bot.sendMessage(chatId, `❌ Failed during Bait-and-Switch flow: ${error.message || error}`);
          if (flow.context) await flow.context.close().catch(() => {});
        }
        return;
      }
    }


    if (/^list\s+track$/i.test(text)) { await enqueueOrReplyTg(bot, msg, { command: 'list_track', payload: {}, chatId }); return; }
    if (/^track\s+status$/i.test(text)) { await enqueueOrReplyTg(bot, msg, { command: 'track_status', payload: {}, chatId }); return; }
    if (/^refresh\s+track$/i.test(text)) { await enqueueOrReplyTg(bot, msg, { command: 'refresh_track', payload: {}, chatId }); return; }

    const trackRcMatch = text.match(/^track\s+rc\s+([A-Z0-9]+)$/i);
    if (trackRcMatch) { await enqueueOrReplyTg(bot, msg, { command: 'track_rc', payload: { appNo: trackRcMatch[1] }, chatId }); return; }

    const addTrackRcMatch = text.match(/^add\s+track\s+rc\s+([A-Z0-9]+)(?:\s*-\s*(.+))?$/i);
    if (addTrackRcMatch) { await enqueueOrReplyTg(bot, msg, { command: 'add_track_rc', payload: { appNo: addTrackRcMatch[1], tag: addTrackRcMatch[2] || '' }, chatId }); return; }

    const removeTrackRcMatch = text.match(/^remove\s+track\s+rc\s+([A-Z0-9]+)$/i);
    if (removeTrackRcMatch) { await enqueueOrReplyTg(bot, msg, { command: 'remove_track_rc', payload: { appNo: removeTrackRcMatch[1] }, chatId }); return; }

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
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    await bot.sendMessage(msg.chat.id, 'Welcome to Sarathi Bot.\nUse /help to see supported commands.');
  });

  bot.onText(/^\/help(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    await bot.sendMessage(msg.chat.id, buildHelpText());
  });

  bot.onText(/^\/(?:alive|suno)(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    try {
      const meme = getRandomAliveMeme();
      await bot.sendAnimation(msg.chat.id, meme.url, { caption: meme.caption });
    } catch (_) {
      await bot.sendMessage(msg.chat.id, 'Bot is alive, but the meme could not be loaded right now.');
    }
  });

  bot.onText(/^\/track(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    if (!appNo) { await bot.sendMessage(chatId, 'Usage: /track <application_number> [dob]'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'track', payload: { appNo, dob }, chatId });
  });

  bot.onText(/^\/appl(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    if (!appNo || !dob) { await bot.sendMessage(chatId, 'Usage: /appl <application_number> <dob>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'appl_pdf', payload: { appNo, dob }, chatId });
  });

  bot.onText(/^\/form1(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    if (!appNo || !dob) { await bot.sendMessage(chatId, 'Usage: /form1 <application_number> <dob>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'form1', payload: { appNo, dob }, chatId });
  });

  bot.onText(/^\/form1a(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    if (!appNo || !dob) { await bot.sendMessage(chatId, 'Usage: /form1a <application_number> <dob>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'form1a', payload: { appNo, dob }, chatId });
  });

  bot.onText(/^\/form2(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    if (!appNo || !dob) { await bot.sendMessage(chatId, 'Usage: /form2 <application_number> <dob>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'form2', payload: { appNo, dob }, chatId });
  });

  bot.onText(/^\/formset(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    if (!appNo || !dob) { await bot.sendMessage(chatId, 'Usage: /formset <application_number> <dob>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'formset', payload: { appNo, dob }, chatId });
  });

  bot.onText(/^\/llprint(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    if (!appNo || !dob) {
      await bot.sendMessage(chatId, 'Usage: /llprint <application_number> <dob> [10_digit_mobile]');
      return;
    }
    // Try to resolve mobile from DB canonical_phone stored at registration.
    // Telegram chat IDs are numeric IDs, not phone numbers — so we check the DB.
    let mobile = args[2] || '';
    try {
      const { getUserByPhone } = require('./services/authorizationRepository');
      const dbUser = await getUserByPhone(String(chatId));
      if (dbUser && dbUser.canonical_phone) {
        const cp = String(dbUser.canonical_phone).replace(/\D/g, '');
        if (cp.length >= 10) mobile = cp.length > 10 ? cp.slice(-10) : cp;
      }
    } catch (_) {}
    if (!mobile || mobile.length < 10) {
      await bot.sendMessage(chatId, 'Mobile number not found in your profile. Please provide it:\nUsage: /llprint <application_number> <dob> <10_digit_mobile>');
      return;
    }
    const cleanMobile = mobile.length > 10 ? mobile.slice(-10) : mobile;
    await enqueueOrReplyTg(bot, msg, { command: 'llprint_start', payload: { appNo, dob, mobile: cleanMobile }, chatId });
  });

  bot.onText(/^\/lledit(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const args = parseArgs(match && match[1]);
    const appNo = args[0];
    const dob = normalizeDob(args[1] || '');
    if (!appNo || !dob) {
      await bot.sendMessage(chatId, 'Usage: /lledit <application_number> <dob> [10_digit_mobile]');
      return;
    }
    let mobile = args[2] || '';
    try {
      const { getUserByPhone } = require('./services/authorizationRepository');
      const dbUser = await getUserByPhone(String(chatId));
      if (dbUser && dbUser.canonical_phone) {
        const cp = String(dbUser.canonical_phone).replace(/\D/g, '');
        if (cp.length >= 10) mobile = cp.length > 10 ? cp.slice(-10) : cp;
      }
    } catch (_) {}
    if (!mobile || mobile.length < 10) {
      await bot.sendMessage(chatId, 'Mobile number not found in your profile. Please provide it:\nUsage: /lledit <application_number> <dob> <10_digit_mobile>');
      return;
    }
    const cleanMobile = mobile.length > 10 ? mobile.slice(-10) : mobile;
    await enqueueOrReplyTg(bot, msg, { command: 'lledit_start', payload: { appNo, dob, mobile: cleanMobile }, chatId });
  });



  bot.onText(/^\/resend(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const appNo = parseArgs(match && match[1])[0];
    if (!appNo) { await bot.sendMessage(chatId, 'Usage: /resend <application_number>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'resend_otp', payload: { appNo: appNo.toUpperCase() }, chatId });
  });

  bot.onText(/^\/addtrack(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const raw = String((match && match[1]) || '').trim();
    const parsed = raw.match(/^(\d+)(?:\s+(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}))?(?:\s*-\s*(.+))?$/i);
    if (!parsed) { await bot.sendMessage(chatId, 'Usage: /addtrack <application_number> [dob] [-tag]'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'add_track', payload: { appNo: parsed[1], dob: normalizeDob(parsed[2] || ''), tag: String(parsed[3] || '').trim() }, chatId });
  });

  bot.onText(/^\/removetrack(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = msg.chat.id;
    const appNo = parseArgs(match && match[1])[0];
    if (!appNo) { await bot.sendMessage(chatId, 'Usage: /removetrack <application_number>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'remove_track', payload: { appNo }, chatId });
  });

  bot.onText(/^\/listtrack(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    await enqueueOrReplyTg(bot, msg, { command: 'list_track', payload: {}, chatId: msg.chat.id });
  });

  bot.onText(/^\/refreshtrack(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    await enqueueOrReplyTg(bot, msg, { command: 'refresh_track', payload: {}, chatId: msg.chat.id });
  });

  bot.onText(/^\/trackrc(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const appNo = parseArgs(match && match[1])[0];
    if (!appNo) { await bot.sendMessage(msg.chat.id, 'Usage: /trackrc <application_number>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'track_rc', payload: { appNo }, chatId: msg.chat.id });
  });

  bot.onText(/^\/addtrackrc(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const raw = String((match && match[1]) || '').trim();
    const parsed = raw.match(/^([A-Z0-9]+)(?:\s*-\s*(.+))?$/i);
    if (!parsed) { await bot.sendMessage(msg.chat.id, 'Usage: /addtrackrc <application_number> [-tag]'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'add_track_rc', payload: { appNo: parsed[1], tag: parsed[2] || '' }, chatId: msg.chat.id });
  });

  bot.onText(/^\/removetrackrc(?:@[^\s]+)?(?:\s+(.+))?$/i, async (msg, match) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const appNo = parseArgs(match && match[1])[0];
    if (!appNo) { await bot.sendMessage(msg.chat.id, 'Usage: /removetrackrc <application_number>'); return; }
    await enqueueOrReplyTg(bot, msg, { command: 'remove_track_rc', payload: { appNo }, chatId: msg.chat.id });
  });

  bot.onText(/^\/stop(?:@[^\s]+)?(?:\s+.*)?$/i, async (msg) => {
    if (!(await isTgAuthorized(msg, CONFIG))) return;
    const chatId = getTelegramChatId(msg);
    if (!hasActiveVahanSession(chatId, 'telegram')) {
      await bot.sendMessage(chatId, 'No active Vahan session is running.');
      return;
    }
    await stopVahanSession(chatId, 'telegram');
    await bot.sendMessage(chatId, 'Vahan session stopped.');
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



