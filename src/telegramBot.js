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

async function getFirstAuthorizedChatId(config) {
  const security = (config && config.SECURITY) || {};
  const users = Array.isArray(security.AUTHORIZED_TG_USERS) ? security.AUTHORIZED_TG_USERS : [];
  const groups = Array.isArray(security.AUTHORIZED_TG_GROUPS) ? security.AUTHORIZED_TG_GROUPS : [];

  if (users[0]) return users[0];

  const repo = require('./services/authorizationRepository');
  try {
    const tgUsers = await repo.query("SELECT canonical_phone FROM auth_users WHERE channel = 'tg' AND is_active = 1 LIMIT 1");
    if (tgUsers && tgUsers[0]) return tgUsers[0].canonical_phone;
  } catch (_) {}

  if (groups[0]) return groups[0];

  try {
    const tgGroups = await repo.getAuthorizedGroups('tg');
    if (tgGroups && tgGroups[0]) return tgGroups[0].group_id;
  } catch (_) {}

  return null;
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
    '/track DL <appl_no> <DOB>',
    '/track RC <appl_no>',
    '/track status',
    '/track add <appl_no> <DOB>',
    '/track add <appl_no>',
    '/track remove <appl_no>',
    '/stop',
    '/appl <appl_no> <DOB>',
    '/form1 <appl_no> <DOB>',
    '/form1a <appl_no> <DOB>',
    '/form2 <appl_no> <DOB>',
    '/formset <appl_no> <DOB>',
    '/llprint <appl_no> <DOB> [10_digit_mobile]',
    '/lledit <appl_no> <DOB> [10_digit_mobile]',
    '/dlrenewal <DL_number> <DOB> [RTO_code] [10_digit_mobile]',
    '/dlapp <LL_number> <DOB> [10_digit_mobile]',
    '/payfee <appl_no> <DOB>',
    '/fees <appl_no> <DOB>',
    '/bookslot <appl_no> <DOB>',
    '/resend <appl_no> <DOB>',
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
    let text = String((msg && msg.text) || '').trim();
    const dailyFillingRouter = require('./services/dailyFillingRouter');
    if (await dailyFillingRouter.handleDailyFillingTelegramMessage(msg, bot, enqueueOrReplyTg)) {
      return;
    }

    if (/^\/?auth\b/i.test(text)) {
      const { isAdminTelegram } = require('./services/authorizationService');
      const { handleAuthCommand } = require('./commands/authAdmin');
      if (!isAdminTelegram(msg, CONFIG)) {
        return;
      }
      const reply = await handleAuthCommand(text, chatId);
      if (reply) {
        await bot.sendMessage(chatId, reply);
        return;
      }
    }

    // Sessions check (these check for raw text, but NOT when starting with the command itself)
    const llprintSessions = getLlprintSessions();
    if (llprintSessions.has(chatId) && !/^\/?llprint/i.test(text)) {
      const flow = llprintSessions.get(chatId);
      const otpCode = text.trim();
      if (otpCode.length > 0 && otpCode.length <= 8) {
        llprintSessions.delete(chatId);
        try {
          const pdfPath = await submitLLPrintOTP(flow.context, flow.page, otpCode, flow.appNo, flow.dob);
          await bot.sendDocument(chatId, pdfPath);
          cleanupFile(pdfPath);
          if (flow.resolveJob) flow.resolveJob({ ok: true, pdfPath });
        } catch (error) {
          await bot.sendMessage(chatId, 'Failed to download Learner Licence or OTP was incorrect.');
          if (flow.rejectJob) flow.rejectJob(error);
          else {
            if (flow.context) await flow.context.close().catch(() => {});
          }
        }
        return;
      }
    }

    const lleditSessions = getLleditSessions();
    if (lleditSessions.has(chatId) && !/^\/?lledit/i.test(text)) {
      const flow = lleditSessions.get(chatId);
      const otpCode = text.trim();
      if (otpCode.length > 0 && otpCode.length <= 8) {
        lleditSessions.delete(chatId);
        try {
          await bot.sendMessage(chatId, '⏳ OTP received. Processing dynamic form filling and priming...');
          await submitLLEditOTP(flow.context, flow.page, otpCode, flow.targetAppNo, flow.targetDob, flow.dynamicData);
          await bot.sendMessage(chatId, '✅ Bait-and-Switch successfully completed! Application updated and session primed.');
          if (flow.resolveJob) flow.resolveJob({ ok: true });
        } catch (error) {
          console.error('lledit error:', error);
          await bot.sendMessage(chatId, `❌ Failed during Bait-and-Switch flow: ${error.message || error}`);
          if (flow.rejectJob) flow.rejectJob(error);
          else {
            if (flow.context) await flow.context.close().catch(() => {});
          }
        }
        return;
      }
    }

    // Intercept simplified interactive command flows
    const interactiveFlowService = require('./services/interactiveFlowService');
    const interactiveResult = interactiveFlowService.detectAndHandle(chatId, text);
    if (interactiveResult.handled) {
      if (interactiveResult.replyText) {
        await bot.sendMessage(chatId, interactiveResult.replyText);
        return;
      }
      if (interactiveResult.executeCommand) {
        text = interactiveResult.executeCommand;
      }
    }

    // Now, run the command normalizer
    const hasMedia = !!(msg.photo || msg.document || msg.video || msg.audio || msg.voice);
    const { getUserForRequest, isAdminTelegram } = require('./services/authorizationService');
    const dbUser = await getUserForRequest(msg, 'telegram');
    const isAdmin = isAdminTelegram(msg, CONFIG);

    const commandNormalizer = require('./services/commandNormalizer');
    const normResult = commandNormalizer.parseCommand(text, hasMedia, dbUser, isAdmin);

    if (normResult.ignore) {
      if (hasActiveVahanSession(chatId, 'telegram')) {
        if (!text && hasMedia) {
          // ignore
        } else {
          await handleVahanIncomingText(vahanTelegramClient, chatId, text, 'telegram');
        }
      }
      return;
    }

    if (normResult.silent) {
      return;
    }

    if (normResult.success === false) {
      if (normResult.error) {
        await bot.sendMessage(chatId, normResult.error);
        return;
      }
      // unmatched / fallback
      if (hasActiveVahanSession(chatId, 'telegram')) {
        if (!text && hasMedia) {
          // ignore
        } else {
          await handleVahanIncomingText(vahanTelegramClient, chatId, text, 'telegram');
        }
      }
      return;
    }

    // Route normalized commands
    const { type, payload } = normResult;

    if (type === 'help') {
      await bot.sendMessage(chatId, normResult.message);
      return;
    }

    if (type === 'alive') {
      try {
        const meme = getRandomAliveMeme();
        await bot.sendAnimation(chatId, meme.url, { caption: meme.caption });
      } catch (_) {
        await bot.sendMessage(chatId, 'Bot is alive, but the meme could not be loaded right now.');
      }
      return;
    }

    if (type === 'stop') {
      if (hasActiveVahanSession(chatId, 'telegram')) {
        await stopVahanSession(chatId, 'telegram');
        await bot.sendMessage(chatId, 'Vahan session stopped.');
      }
      return;
    }

    if (type === 'llprint_start' || type === 'lledit_start' || type === 'dl_renewal_start' || type === 'apply_dl_start') {
      // Resolve mobile number for llprint / lledit / dlrenewal / applydl
      let mobile = payload.mobile || '';
      if (!mobile) {
        if (dbUser && dbUser.canonical_phone) {
          const cp = String(dbUser.canonical_phone).replace(/\D/g, '');
          if (cp.length >= 10) mobile = cp.length > 10 ? cp.slice(-10) : cp;
        }
      }
      if (!mobile || mobile.length < 10) {
        let cmdName = type === 'llprint_start' ? 'llprint' :
                      type === 'lledit_start' ? 'lledit' :
                      type === 'dl_renewal_start' ? 'dlrenewal' : 'dlapp';
        let placeholder = type === 'dl_renewal_start' ? '<DL_number> <dob> [RTO_code] <10_digit_mobile>' :
                          type === 'apply_dl_start' ? '<LL_number> <dob> <10_digit_mobile>' :
                          `<appl_no> <dob> <10_digit_mobile>`;
        await bot.sendMessage(chatId, `❌ Mobile number not found in your profile. Please ask admin to link it or use: \`/${cmdName} ${placeholder}\``);
        return;
      }
      const cleanMobile = mobile.length > 10 ? mobile.slice(-10) : mobile;
      await enqueueOrReplyTg(bot, msg, { command: type, payload: { ...payload, mobile: cleanMobile }, chatId });
      return;
    }

    // Map other actions directly to enqueueOrReplyTg
    await enqueueOrReplyTg(bot, msg, { command: type, payload, chatId });
  });

  console.log('Telegram bot started.');
  return bot;
}
async function notifyFirstAuthorizedChat(config, text) {
  const telegramConfig = getTelegramConfig(config || CONFIG);
  const chatId = await getFirstAuthorizedChatId(config || CONFIG);
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



