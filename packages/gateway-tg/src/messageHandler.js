'use strict';
/**
 * gateway-tg — Telegram Gateway Message Handler
 *
 * Handles incoming Telegram messages:
 *  - Authorization check
 *  - OTP session forwarding via Redis Pub/Sub
 *  - DOB / interactive flow session handling
 *  - Command normalization and BullMQ enqueue via requestPipeline
 *  - New WA-parity commands: balance, history, plan, topup, paid <UTR>
 */

const {
  config: CONFIG,
  redis,
  requestPipeline,
  commandNormalizer,
  authorizationService,
  authorizationRepository: authRepo,
  interactiveFlowService,
  commandInputService,
  chatNotifier,
} = require('@sarathi/common');

function normalizeTgText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forward OTP text to listening browser worker via Redis pub/sub.
 * Returns true if forwarded, false otherwise.
 */
async function tryForwardOtp(chatId, text) {
  const otpSessionRaw = await redis.get(`session:otp:${chatId}`);
  if (!otpSessionRaw) return false;

  const otpSession = JSON.parse(otpSessionRaw);
  const otpCode = text.trim();
  if (otpCode.length > 0 && otpCode.length <= 8) {
    await redis.publish(`otp:input:${otpSession.jobId}`, otpCode);
    return true;
  }
  return false;
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

    // 2. Check for active OTP session (browser worker waiting for OTP input)
    const forwarded = await tryForwardOtp(chatId, normalizedText);
    if (forwarded) {
      await bot.sendMessage(chatId, '⏳ OTP received. Forwarding for processing...');
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
              payload = _resolveMobile(payload, dbUser, chatId);
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

    if (normResult.ignore || normResult.silent) return;

    if (normResult.success === false) {
      if (normResult.error) await bot.sendMessage(chatId, normResult.error);
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
      const upiId = CONFIG.PAYMENT?.UPI_ID || process.env.UPI_ID || 'sarathi@upi';
      const upiName = CONFIG.PAYMENT?.UPI_NAME || process.env.UPI_NAME || 'Sarathi Bot';
      await bot.sendMessage(chatId,
        `💰 *Topup Instructions:*\n\n` +
        `Send payment to UPI:\n` +
        `👉 *UPI ID:* \`${upiId}\`\n` +
        `👉 *Name:* ${upiName}\n\n` +
        `*Pricing:*\n• ₹1 = 1 Credit\n• Minimum: 100 Credits (₹100)\n\n` +
        `*After Payment:*\nSend the 12-digit UTR number:\n` +
        `👉 \`paid <UTR_NUMBER>\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (type === 'paid') {
      const { utr, amount = 0 } = payload;
      const cleanUtr = String(utr).trim().replace(/\D/g, '');
      if (cleanUtr.length !== 12) {
        await bot.sendMessage(chatId, '❌ Invalid UTR number! UPI UTR must be exactly 12 digits.');
        return;
      }
      try {
        const [existing] = await authRepo.query('SELECT status FROM payment_requests WHERE utr = ?', [cleanUtr]);
        if (existing) {
          await bot.sendMessage(chatId, `⚠️ This UTR has already been submitted (status: ${existing.status.toUpperCase()}).`);
          return;
        }
        await authRepo.createPaymentRequest(dbUser.id, cleanUtr, amount);
        await bot.sendMessage(chatId, '✅ Payment submitted! Admin will verify within 24 hours. Credits will be added after verification.');

        const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
        if (webhookUrl) {
          try {
            await chatNotifier.sendDiscordAlert(
              '💰 New Payment Request (Telegram)',
              `**User:** ${dbUser.name || 'Unknown'} (${dbUser.canonical_phone})\n**UTR:** \`${cleanUtr}\`\n**Amount:** ₹${amount || 'Unspecified'}`,
              'info'
            );
          } catch (_) {}
        }
      } catch (err) {
        console.error(`[gateway-tg] UTR submission error: ${err.message}`);
        await bot.sendMessage(chatId, '❌ Failed to submit payment. Please try again later.');
      }
      return;
    }

    // ── Resolve mobile number for browser commands ────────────────────────────
    let finalPayload = payload;
    if (['llprint_start', 'lledit_start', 'dl_renewal_start', 'apply_dl_start', 'mobupdate_start'].includes(type)) {
      finalPayload = _resolveMobile(payload, dbUser, chatId);
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

/**
 * Resolves mobile number from payload, dbUser profile, or chatId (Telegram numeric ID).
 */
function _resolveMobile(payload, dbUser, chatId) {
  let mobile = payload.mobile || '';
  if (!mobile && dbUser && dbUser.canonical_phone) {
    const cp = String(dbUser.canonical_phone).replace(/\D/g, '');
    mobile = cp.length > 10 ? cp.slice(-10) : cp;
  }
  if (!mobile) {
    // Telegram chatIds are numeric but not phone numbers — just pass empty string
    mobile = '';
  }
  return { ...payload, mobile };
}

module.exports = { handleIncomingMessage };
