'use strict';
/**
 * gateway-tg — Telegram Gateway Message Handler
 *
 * Handles incoming Telegram messages:
 *  - Authorization check
 *  - OTP session forwarding via Redis Pub/Sub
 *  - DOB / interactive flow session handling
 *  - Command normalization and BullMQ enqueue via requestPipeline
 *  - New WA-parity commands: balance, history, plan, Razorpay topup
 */

const http = require('http');
const https = require('https');
const {
  config: CONFIG,
  redis,
  requestPipeline,
  commandNormalizer,
  authorizationService,
  authorizationRepository: authRepo,
  interactiveFlowService,
  commandInputService,
} = require('@sarathi/common');
const { handleAuthCommand } = require('../../../src/commands/authAdmin');
const {
  handleIncomingText: handleVahanIncomingText,
  hasActiveSession: hasActiveVahanSession,
  stopSession: stopVahanSession,
} = require('../../../src/services/vahanService');

function normalizeTgText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const proto = String(url || '').startsWith('https') ? https : http;
    proto.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Image download failed with HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Forward active browser-worker interactive input via Redis pub/sub.
 * The key name is historical: it is also used for payment, slot, Aadhaar,
 * and mobile-update inputs, not only OTP codes.
 * Returns true if forwarded, false otherwise.
 */
async function tryForwardInteractiveInput(bot, chatId, text) {
  const otpSessionRaw = await redis.get(`session:otp:${chatId}`);
  if (!otpSessionRaw) return false;

  const otpSession = JSON.parse(otpSessionRaw);
  const input = String(text || '').trim();
  if (!input || startsBrowserCommand(input)) {
    return false;
  }

  if (/^(?:stop|cancel)$/i.test(input)) {
    await redis.publish(`otp:input:${otpSession.jobId}`, input);
    await redis.del(`session:otp:${chatId}`).catch(() => {});
    await bot.sendMessage(chatId, '✅ Pending session stopped.');
    return true;
  }

  await redis.publish(`otp:input:${otpSession.jobId}`, input);
  const status = String(otpSession.status || '');
  if (status.includes('payment')) {
    await bot.sendMessage(chatId, '⏳ Payment confirmation received. Forwarding for processing...');
  } else if (status.includes('slot')) {
    await bot.sendMessage(chatId, '⏳ Slot input received. Forwarding for processing...');
  } else if (status.includes('aadhaar') || status.includes('mobile')) {
    await bot.sendMessage(chatId, '⏳ Input received. Forwarding for processing...');
  } else {
    await bot.sendMessage(chatId, '⏳ OTP received. Forwarding for processing...');
  }
  return true;
}

async function clearPendingSessions(chatId) {
  const keys = [`session:otp:${chatId}`, `session:dob:${chatId}`];
  let cleared = 0;
  for (const key of keys) {
    const existed = await redis.del(key).catch(() => 0);
    cleared += Number(existed || 0);
  }
  return cleared;
}

function makeVahanTelegramClient(bot) {
  return {
    sendText: async (chatId, text) => bot.sendMessage(chatId, text),
    sendImage: async (chatId, imagePath, caption) => bot.sendPhoto(chatId, imagePath, { caption }),
  };
}

async function forwardToVahanIfActive(bot, chatId, text, hasMedia) {
  if (!hasActiveVahanSession(chatId, 'telegram')) {
    return false;
  }
  if (!text && hasMedia) {
    return true;
  }
  await handleVahanIncomingText(makeVahanTelegramClient(bot), chatId, text, 'telegram');
  return true;
}

function startsBrowserCommand(text) {
  return /^\/?(?:llprint|lledit|payfee|feeprint|fees|dlrenewal|renewal|duplicate|replacement|dlextract|dlapp|bookslot|mobupdate)\b/i.test(String(text || '').trim());
}

function requiresTelegramProfileMobile(commandType) {
  return ['llprint_start', 'lledit_start', 'dl_renewal_start', 'apply_dl_start'].includes(commandType);
}

function getTelegramMobileHelp(commandType) {
  const cmdName = commandType === 'llprint_start'
    ? 'llprint'
    : commandType === 'lledit_start'
      ? 'lledit'
      : commandType === 'dl_renewal_start'
        ? 'dlrenewal'
        : 'dlapp';
  const placeholder = commandType === 'dl_renewal_start'
    ? '<DL_number> <dob> [RTO_code] <10_digit_mobile>'
    : commandType === 'apply_dl_start'
      ? '<LL_number> <dob> <10_digit_mobile>'
      : '<appl_no> <dob> <10_digit_mobile>';
  return `❌ Mobile number not found in your profile. Please ask admin to link it or use: \`/${cmdName} ${placeholder}\``;
}

async function resolveTelegramMobileOrReply(bot, chatId, payload, dbUser, commandType) {
  let mobile = payload.mobile || '';
  if (!mobile && dbUser && dbUser.canonical_phone) {
    const cp = String(dbUser.canonical_phone).replace(/\D/g, '');
    if (cp.length >= 10) {
      mobile = cp.length > 10 ? cp.slice(-10) : cp;
    }
  }

  if (requiresTelegramProfileMobile(commandType) && (!mobile || mobile.length < 10)) {
    await bot.sendMessage(chatId, getTelegramMobileHelp(commandType));
    return null;
  }

  return { ...payload, mobile: mobile && mobile.length > 10 ? mobile.slice(-10) : mobile };
}

async function handleIncomingMessage(bot, msg) {
  const chatId = String((msg && msg.chat && msg.chat.id) || '').trim();
  if (!chatId) return;

  const normalizedText = normalizeTgText((msg && msg.text) || '');
  const hasMedia = !!(msg.photo || msg.document || msg.video || msg.audio || msg.voice);

  try {
    // 1. Authorization check
    const isAuth = await authorizationService.isAuthorizedTelegram(msg, CONFIG);
    if (!isAuth) {
      console.log(`[gateway-tg] Unauthorized Telegram message from ${chatId} blocked.`);
      return;
    }

    const dbUser = await authorizationService.getUserForRequest(msg, 'telegram');
    const isAdmin = authorizationService.isAdminTelegram(msg, CONFIG);

    if (/^\/?auth\b/i.test(normalizedText)) {
      if (!isAdmin) {
        return;
      }
      const reply = await handleAuthCommand(normalizedText, chatId);
      if (reply) {
        await bot.sendMessage(chatId, reply);
        return;
      }
    }

    // 2. Check for active browser-worker interactive session.
    const forwarded = await tryForwardInteractiveInput(bot, chatId, normalizedText);
    if (forwarded) {
      return;
    }

    // 3. Check Redis for pending DOB flow
    const dobSessionRaw = await redis.get(`session:dob:${chatId}`);
    if (dobSessionRaw && !/^track\b/i.test(normalizedText)) {
      const pendingDob = JSON.parse(dobSessionRaw);
      const suppliedDob = commandInputService.normalizeDob(normalizedText);
      if (suppliedDob) {
        await redis.del(`session:dob:${chatId}`).catch(() => {});
        await bot.sendMessage(chatId, '⏳ Processing tracking with supplied DOB...');
        const result = await requestPipeline.processRequest(msg, 'telegram', {
          command: 'track',
          payload: { appNo: pendingDob.appNo, dob: suppliedDob },
          chatId,
        });
        if (result.blocked) {
          await bot.sendMessage(chatId, `🚫 ${result.message}`);
        }
        return;
      }
    }

    // 4. Interactive flow session handling
    const interactiveResult = await interactiveFlowService.detectAndHandle(chatId, normalizedText, dbUser, isAdmin);
    if (interactiveResult.handled) {
      if (interactiveResult.replyText) {
        await bot.sendMessage(chatId, interactiveResult.replyText);
        return;
      }
      if (interactiveResult.executeCommands && interactiveResult.executeCommands.length > 0) {
        for (const cmdText of interactiveResult.executeCommands) {
          const norm = commandNormalizer.parseCommand(cmdText, hasMedia, dbUser, isAdmin);
          if (norm && norm.success) {
            let payload = norm.payload || {};
            if (['llprint_start', 'lledit_start', 'dl_renewal_start', 'apply_dl_start', 'mobupdate_start'].includes(norm.type)) {
              payload = await resolveTelegramMobileOrReply(bot, chatId, payload, dbUser, norm.type);
              if (!payload) {
                continue;
              }
            }
            const result = await requestPipeline.processRequest(msg, 'telegram', {
              command: norm.type, payload, chatId,
            });
            if (result.blocked) {
              await bot.sendMessage(chatId, `🚫 ${result.message}`);
            } else {
              await bot.sendMessage(chatId, '⏳ Processing...');
            }
          }
        }
        return;
      }
    }

    // 5. Parse and route command
    const normResult = commandNormalizer.parseCommand(normalizedText, hasMedia, dbUser, isAdmin);

    if (normResult.ignore) {
      await forwardToVahanIfActive(bot, chatId, normalizedText, hasMedia);
      return;
    }

    if (normResult.silent) return;

    if (normResult.success === false) {
      if (normResult.error) {
        await bot.sendMessage(chatId, normResult.error);
        return;
      }
      await forwardToVahanIfActive(bot, chatId, normalizedText, hasMedia);
      return;
    }

    const { type, payload } = normResult;

    // ── Built-in responses (no queueing needed) ──────────────────────────────

    if (type === 'help') {
      await bot.sendMessage(chatId, normResult.message);
      return;
    }

    if (type === 'alive') {
      const uptime = Math.floor(process.uptime());
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = uptime % 60;
      await bot.sendMessage(chatId, `✅ *Sarathi Bot is Online*\n⏱️ *Uptime:* ${h}h ${m}m ${s}s\n📡 *Gateway:* tg-primary`);
      return;
    }

    if (type === 'stop') {
      const cleared = await clearPendingSessions(chatId);
      if (hasActiveVahanSession(chatId, 'telegram')) {
        await stopVahanSession(chatId, 'telegram');
        await bot.sendMessage(chatId, 'Vahan session stopped.');
        return;
      }
      if (cleared > 0) {
        await bot.sendMessage(chatId, '✅ Pending session stopped.');
      }
      return;
    }

    if (type === 'balance') {
      const credits = dbUser.credits || 0;
      const planName = dbUser.subscription_plan || 'free';
      const expiry = dbUser.expiry_date
        ? new Date(dbUser.expiry_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
        : 'Never';
      const dailyUsed = dbUser.daily_count || 0;
      let dailyLimit = 'N/A';
      try {
        const [planRow] = await authRepo.query('SELECT limits_json FROM subscription_plans WHERE id = ?', [planName]);
        if (planRow && planRow.limits_json) {
          const limits = typeof planRow.limits_json === 'string' ? JSON.parse(planRow.limits_json) : planRow.limits_json;
          dailyLimit = limits.light?.perDay || limits.perDay || 20;
        }
      } catch (_) {}
      await bot.sendMessage(chatId,
        `💰 *Balance & Plan:*\n\n` +
        `• *Credits:* ${credits}\n` +
        `• *Plan:* ${planName.toUpperCase()}\n` +
        `• *Expires:* ${expiry}\n` +
        `• *Today:* ${dailyUsed}/${dailyLimit} used`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (type === 'history') {
      const history = await authRepo.getCreditHistory(dbUser.id, 10);
      if (!history || history.length === 0) {
        await bot.sendMessage(chatId, '📝 *Credit History:*\n\nNo transactions found.', { parse_mode: 'Markdown' });
        return;
      }
      let response = `📝 *Credit History:*\n\n`;
      history.forEach((tx) => {
        const dateStr = new Date(tx.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
        const sign = tx.action === 'add' ? '➕ +' : '➖ -';
        const note = tx.note ? ` (${tx.note})` : '';
        response += `• [${dateStr}] ${sign}${tx.amount} credits${note} (Bal: ${tx.balance_after})\n`;
      });
      await bot.sendMessage(chatId, response.trim(), { parse_mode: 'Markdown' });
      return;
    }

    if (type === 'plan') {
      const planName = dbUser.subscription_plan || 'free';
      const [planRow] = await authRepo.query('SELECT * FROM subscription_plans WHERE id = ?', [planName]);
      if (!planRow) {
        await bot.sendMessage(chatId, '❌ Plan details not found.');
        return;
      }
      let limits = {};
      try { limits = typeof planRow.limits_json === 'string' ? JSON.parse(planRow.limits_json) : planRow.limits_json; } catch (_) {}
      await bot.sendMessage(chatId,
        `📋 *Your Plan Details:*\n\n` +
        `• *Plan:* ${planRow.name}\n` +
        `• *Description:* ${planRow.description || '-'}\n\n` +
        `*Daily Limits:*\n` +
        `• Light (Status/Track): ${limits.light?.perDay || 20}/day\n` +
        `• Medium (LL Print/Forms): ${limits.medium?.perDay || 5}/day\n` +
        `• Heavy (DL Renewal/Apply): Governed by credits`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (type === 'topup') {
      const { razorpayService } = require('@sarathi/common');
      const requestedAmount = payload.amount ? parseInt(payload.amount, 10) : 100;
      const amount = (isNaN(requestedAmount) || requestedAmount < 100) ? 100 : requestedAmount;

      if (!razorpayService.isRazorpayEnabled()) {
        await bot.sendMessage(chatId, '❌ Razorpay top-up is not configured right now. Please ask the admin to set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
        return;
      }

      try {
        await bot.sendMessage(chatId, `⏳ Creating Razorpay QR for ₹${amount}...`);
        const qr = await razorpayService.createPaymentQR(amount, dbUser.id, chatId, 'telegram');
        if (!qr || !qr.imageUrl) {
          throw new Error('QR creation returned null');
        }

        const imgBuffer = await downloadImage(qr.imageUrl);
        await bot.sendPhoto(chatId, imgBuffer, {
          caption:
            `💰 ₹${amount} Razorpay recharge QR\n\n` +
            `Scan this QR using any UPI app.\n` +
            `Credits will be added automatically after payment.\n\n` +
            `For another amount, send: topup 200 or topup 500`,
        });
      } catch (err) {
        console.error(`[gateway-tg] Razorpay QR error: ${err.message}`);
        await bot.sendMessage(chatId, '❌ Failed to create Razorpay QR. Please try again later or contact admin.');
      }
      return;
    }

    if (type === 'paid') {
      await bot.sendMessage(chatId, '❌ Manual UPI/UTR wallet top-up is disabled. Please send `topup 100` or `topup 500` to generate a Razorpay QR code.');
      return;
    }

    // ── Resolve mobile number for browser commands ────────────────────────────
    let finalPayload = payload;
    if (['llprint_start', 'lledit_start', 'dl_renewal_start', 'apply_dl_start', 'mobupdate_start'].includes(type)) {
      finalPayload = await resolveTelegramMobileOrReply(bot, chatId, payload, dbUser, type);
      if (!finalPayload) {
        return;
      }
    }

    // ── Enqueue all other commands ────────────────────────────────────────────
    const result = await requestPipeline.processRequest(msg, 'telegram', {
      command: type,
      payload: finalPayload,
      chatId,
    });

    if (result.blocked) {
      await bot.sendMessage(chatId, `🚫 ${result.message}`);
    } else {
      await bot.sendMessage(chatId, '⏳ Request queued for processing...');
    }

  } catch (error) {
    console.error(`[gateway-tg] Error handling message from ${chatId}: ${error.stack}`);
    try { await bot.sendMessage(chatId, '❌ Something went wrong. Please try again later.'); } catch (_) {}
  }
}

module.exports = { handleIncomingMessage };
