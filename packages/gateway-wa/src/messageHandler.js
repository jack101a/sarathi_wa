const {
  config: CONFIG,
  redis,
  requestPipeline,
  commandNormalizer,
  authorizationService,
  authorizationRepository: authRepo,
  interactiveFlowService,
  commandInputService,
  authorizationNormalizer
} = require('@sarathi/common');
const { consumeVerificationMessage } = require('../../../src/services/waVerificationService');

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function maskChatId(value) {
  const text = String(value || '');
  if (text.length <= 8) return text;
  return `${text.slice(0, 4)}...${text.slice(-8)}`;
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

async function replyPendingActivationIfAny(message) {
  const pureSender = authorizationService.getWhatsAppSenderId(message);
  if (!pureSender) return false;

  const candidates = [pureSender];
  if (pureSender.length > 10) {
    candidates.push(pureSender.slice(-10));
  }

  for (const phone of [...new Set(candidates)]) {
    const user = await authRepo.getUserByPhone(phone);
    if (!user || Number(user.is_active) !== 1) {
      continue;
    }

    const hasPending = await authRepo.hasPendingVerification(user.canonical_phone);
    if (!hasPending) {
      continue;
    }

    const [row] = await authRepo.query(
      "SELECT code FROM auth_verifications WHERE canonical_phone = ? AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP ORDER BY expires_at DESC LIMIT 1",
      [user.canonical_phone]
    );
    if (!row || !row.code) {
      continue;
    }

    await message.reply(`⚠️ *Account Pending Activation*\n\nYour account has been created by the administrator but is not active yet.\n\nPlease reply directly to this chat with your 8-character activation code: *${row.code}* to link and activate your WhatsApp account.`);
    return true;
  }

  return false;
}

async function handleIncomingMessage(client, message) {
  let normalizedBody = normalizeText(message.body || '');

  console.log(`[MessageHandler] Incoming WA message from=${maskChatId(message.from)} author=${maskChatId(message.author)} type=${message.type || 'unknown'} length=${normalizedBody.length}`);

  // Deduplication check. SET NX EX is atomic across all gateway instances.
  // Only the first instance to claim this key processes the message.
  if (message.id && message.id.id) {
    try {
      const created = await redis.set(`dedup:msg:${message.id.id}`, process.env.INSTANCE_ID || '1', 'EX', 300, 'NX');
      if (!created) {
        return;
      }
    } catch (err) {
      console.error(`[MessageHandler] Redis dedup check error: ${err.message}`);
    }
  }


  try {
    const compactCode = normalizedBody.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const isVerificationFormat = /^(?:auth\s+\d+\s+[a-z0-9]{6,8})$/i.test(normalizedBody) || /^[A-Z0-9]{8}$/.test(compactCode);
    if (isVerificationFormat) {
      const idContext = authorizationNormalizer.extractIdentityFromMessage(message);
      const ok = await consumeVerificationMessage(normalizedBody, idContext);
      console.log(`[MessageHandler] Verification code attempt from=${maskChatId(message.from)} matched=${ok}`);
      if (ok) {
        await message.reply('✅ Verification successful! Your WhatsApp account has been fully activated and linked.');
        return;
      }
    }

    // 2. Authorization check
    const isAuth = await authorizationService.isAuthorizedWhatsApp(message, CONFIG);
    if (!isAuth) {
      if (await replyPendingActivationIfAny(message)) {
        return;
      }
      console.log(`[MessageHandler] Unauthorized message from ${message.from} blocked.`);
      return;
    }

    const dbUser = await authorizationService.getUserForRequest(message, 'whatsapp');
    const isAdmin = authorizationService.isAdminWhatsApp(message, CONFIG);

    // 3. Check Redis for active OTP session (llprint / lledit)
    const otpSessionKey = `session:otp:${message.from}`;
    const otpSessionRaw = await redis.get(otpSessionKey);
    if (otpSessionRaw && !normalizedBody.startsWith('/llprint') && !normalizedBody.startsWith('/lledit')) {
      const otpSession = JSON.parse(otpSessionRaw);
      const otpCode = normalizedBody.trim();
      if (otpCode.length > 0 && otpCode.length <= 8) {
        // Forward OTP code via Redis Pub/Sub to the listening worker
        await redis.publish(`otp:input:${otpSession.jobId}`, otpCode);
        await message.reply('⏳ OTP received. Forwarding for processing...');
        return;
      }
    }

    // 4. Check Redis for pending DOB flow
    const dobSessionKey = `session:dob:${message.from}`;
    const dobSessionRaw = await redis.get(dobSessionKey);
    if (dobSessionRaw && !/^track\b/i.test(normalizedBody)) {
      const pendingDob = JSON.parse(dobSessionRaw);
      const suppliedDob = commandInputService.normalizeDob(normalizedBody);
      if (suppliedDob) {
        await redis.del(dobSessionKey).catch(() => {});
        await message.reply('⏳ Processing tracking with supplied DOB...');
        const result = await requestPipeline.processRequest(message, 'whatsapp', {
          command: 'track',
          payload: { appNo: pendingDob.appNo, dob: suppliedDob },
          chatId: message.from,
          dedupKey: message.id && message.id.id ? `wa:${message.id.id}:track-dob` : undefined,
        });
        if (result.blocked) {
          await message.reply(`🚫 ${result.message}`);
        }
        return;
      }
    }

    // 5. Intercept simplified interactive command flows
    const interactiveResult = await interactiveFlowService.detectAndHandle(message.from, normalizedBody, dbUser, isAdmin);
    if (interactiveResult.handled) {
      if (interactiveResult.replyText) {
        await message.reply(interactiveResult.replyText);
        return;
      }
      if (interactiveResult.executeCommands && interactiveResult.executeCommands.length > 0) {
        for (const cmdText of interactiveResult.executeCommands) {
          const norm = commandNormalizer.parseCommand(cmdText, message.hasMedia, dbUser, isAdmin);
          if (norm && norm.success) {
            let payload = norm.payload || {};
            if (norm.type === 'llprint_start' || norm.type === 'lledit_start' || norm.type === 'dl_renewal_start' || norm.type === 'apply_dl_start' || norm.type === 'mobupdate_start') {
              let mobile = payload.mobile || '';
              if (!mobile) {
                if (dbUser && dbUser.canonical_phone) {
                  const cp = String(dbUser.canonical_phone).replace(/\D/g, '');
                  mobile = cp.length > 10 ? cp.slice(-10) : cp;
                }
              }
              if (!mobile) {
                const senderPhone = (message.from || '').split('@')[0].replace(/\D/g, '');
                mobile = senderPhone.length > 10 ? senderPhone.slice(-10) : senderPhone;
              }
              payload = { ...payload, mobile };
            }
            const result = await requestPipeline.processRequest(message, 'whatsapp', {
              command: norm.type,
              payload,
              chatId: message.from,
              dedupKey: message.id && message.id.id ? `wa:${message.id.id}:${norm.type}` : undefined,
            });
            if (result.blocked) {
              await message.reply(`🚫 ${result.message}`);
            } else {
              await message.reply('⏳ Request queued for processing...');
            }
          }
        }
        return;
      }
      if (interactiveResult.executeCommand) {
        normalizedBody = interactiveResult.executeCommand;
      }
    }

    // 6. Regular parsing & normalization
    const normResult = commandNormalizer.parseCommand(normalizedBody, message.hasMedia, dbUser, isAdmin);

    if (normResult.ignore) {
      return;
    }

    if (normResult.silent) {
      return;
    }

    if (normResult.success === false) {
      if (normResult.error) {
        await message.reply(normResult.error);
      }
      return;
    }

    // Route normalized commands
    const { type, payload } = normResult;

    if (type === 'help') {
      await message.reply(normResult.message);
      return;
    }

    if (type === 'alive') {
      const uptime = Math.floor(process.uptime());
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;
      await message.reply(`✅ *Sarathi Bot is Online*\n⏱️ *Uptime:* ${hours}h ${minutes}m ${seconds}s\n📡 *Gateway:* ${process.env.INSTANCE_ID || 'wa-primary'}`);
      return;
    }

    if (type === 'stop') {
      const cleared = await clearPendingSessions(message.from);
      if (cleared > 0) {
        await message.reply('✅ Pending session stopped.');
      }
      return;
    }

    if (type === 'balance') {
      const credits = dbUser.credits || 0;
      const planName = dbUser.subscription_plan || 'free';
      const expiry = dbUser.expiry_date ? new Date(dbUser.expiry_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : 'Never';
      const dailyUsed = dbUser.daily_count || 0;
      
      let dailyLimit = 'N/A';
      try {
        const [planRow] = await authRepo.query('SELECT limits_json FROM subscription_plans WHERE id = ?', [planName]);
        if (planRow && planRow.limits_json) {
          const limits = typeof planRow.limits_json === 'string' ? JSON.parse(planRow.limits_json) : planRow.limits_json;
          dailyLimit = limits.light?.perDay || limits.perDay || 20;
        }
      } catch (_) {}

      const formattedPlan = planName.toUpperCase();
      const response = `💰 *बैलेंस और प्लान (Balance & Plan):*\n\n` +
        `• *क्रेडिट बैलेंस (Credits):* ${credits} credits\n` +
        `• *सक्रिय प्लान (Plan):* ${formattedPlan}\n` +
        `• *समाप्ति तिथि (Expires):* ${expiry}\n` +
        `• *आज का उपयोग (Today):* ${dailyUsed}/${dailyLimit} used`;
      await message.reply(response);
      return;
    }

    if (type === 'history') {
      const history = await authRepo.getCreditHistory(dbUser.id, 10);
      if (!history || history.length === 0) {
        await message.reply('📝 *क्रेडिट लेन-देन का इतिहास (Credit History):*\n\nकोई लेन-देन नहीं मिला (No transactions found).');
        return;
      }

      let response = `📝 *क्रेडिट लेन-देन का इतिहास (Credit History):*\n\n`;
      history.forEach((tx) => {
        const dateStr = new Date(tx.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
        const sign = tx.action === 'add' ? '➕ +' : '➖ -';
        const note = tx.note ? ` (${tx.note})` : '';
        response += `• [${dateStr}] ${sign}${tx.amount} credits${note} (Bal: ${tx.balance_after})\n`;
      });

      await message.reply(response.trim());
      return;
    }

    if (type === 'plan') {
      const planName = dbUser.subscription_plan || 'free';
      const [planRow] = await authRepo.query('SELECT * FROM subscription_plans WHERE id = ?', [planName]);
      if (!planRow) {
        await message.reply('❌ सक्रिय प्लान की जानकारी नहीं मिली (Plan details not found).');
        return;
      }

      let limits = {};
      try { limits = typeof planRow.limits_json === 'string' ? JSON.parse(planRow.limits_json) : planRow.limits_json; } catch(_) {}

      let response = `📋 *आपके प्लान की जानकारी (Your Plan Details):*\n\n` +
        `• *प्लान का नाम (Plan Name):* ${planRow.name}\n` +
        `• *विवरण (Description):* ${planRow.description || '-'}\n\n` +
        `*दैनिक लिमिट (Daily Limits):*\n` +
        `• *Light Services (Status/Tracking):* ${limits.light?.perDay || 20} per day\n` +
        `• *Medium Services (LL Print/Forms):* ${limits.medium?.perDay || 5} per day\n` +
        `• *Heavy Services (DL Renewal/Apply):* No limit (governed by credits)\n\n` +
        `💡 _सक्रिय प्लान की सीमाएं और लागत जानने के लिए balance कमांड चलाएं।_`;

      await message.reply(response);
      return;
    }

    if (type === 'topup') {
      const { razorpayService } = require('@sarathi/common');
      const https = require('https');
      const http = require('http');

      // Amount from command: "topup 500" → ₹500, default ₹100
      const requestedAmount = payload.amount ? parseInt(payload.amount, 10) : 100;
      const amount = (isNaN(requestedAmount) || requestedAmount < 100) ? 100 : requestedAmount;

      if (!razorpayService.isRazorpayEnabled()) {
        await message.reply(
          '❌ Razorpay top-up is not configured right now.\nPlease ask the admin to set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
        );
        return;
      }

      try {
        await message.reply(`⏳ *₹${amount} का Razorpay QR कोड बना रहे हैं...*`);

        const chatId = message.from;
        const transport = 'whatsapp';
        const qr = await razorpayService.createPaymentQR(amount, dbUser.id, chatId, transport);

        if (!qr || !qr.imageUrl) {
          throw new Error('QR creation returned null');
        }

        const downloadImage = (url) => new Promise((resolve, reject) => {
          const proto = url.startsWith('https') ? https : http;
          proto.get(url, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
          }).on('error', reject);
        });

        const imgBuffer = await downloadImage(qr.imageUrl);
        const base64 = imgBuffer.toString('base64');

        const { MessageMedia } = require('whatsapp-web.js');
        const media = new MessageMedia('image/png', base64, 'topup_qr.png');

        const caption =
          `💰 *₹${amount} Razorpay रिचार्ज QR कोड*\n\n` +
          `📲 इस QR को किसी भी UPI ऐप से स्कैन करें:\n` +
          `_(Google Pay, PhonePe, Paytm, BHIM)_\n\n` +
          `✅ भुगतान होते ही *क्रेडिट स्वचालित रूप से जुड़ जाएंगे।*\n` +
          `⚠️ यह QR एक बार उपयोग के लिए है।\n\n` +
          `_अलग राशि के लिए:_ \`topup 200\` _या_ \`topup 500\``;

        await client.sendMessage(chatId, media, { caption });
      } catch (err) {
        console.error(`[MessageHandler] Razorpay QR error: ${err.message}`);
        await message.reply('❌ Razorpay QR बनाने में समस्या आई। कृपया कुछ देर बाद फिर कोशिश करें या admin से संपर्क करें।');
      }
      return;
    }

    if (type === 'paid') {
      await message.reply('❌ Manual UPI/UTR wallet top-up is disabled. Please send `topup 100` or `topup 500` to generate a Razorpay QR code.');
      return;
    }

    // Deduce default mobile number if needed
    if (type === 'llprint_start' || type === 'lledit_start' || type === 'dl_renewal_start' || type === 'apply_dl_start' || type === 'mobupdate_start') {
      let mobile = payload.mobile || '';
      if (!mobile) {
        if (dbUser && dbUser.canonical_phone) {
          const cp = String(dbUser.canonical_phone).replace(/\D/g, '');
          mobile = cp.length > 10 ? cp.slice(-10) : cp;
        }
      }
      if (!mobile) {
        const senderPhone = (message.from || '').split('@')[0].replace(/\D/g, '');
        mobile = senderPhone.length > 10 ? senderPhone.slice(-10) : senderPhone;
      }
      payload.mobile = mobile;
    }

    const result = await requestPipeline.processRequest(message, 'whatsapp', {
      command: type,
      payload,
      chatId: message.from,
      dedupKey: message.id && message.id.id ? `wa:${message.id.id}:${type}` : undefined,
    });

    if (result.blocked) {
      await message.reply(`🚫 ${result.message}`);
    } else {
      await message.reply('⏳ Request queued for processing...');
    }

  } catch (error) {
    console.error(`[MessageHandler] Error handling message: ${error.stack}`);
    await message.reply('❌ Something went wrong. Please try again later.');
  }
}

module.exports = {
  handleIncomingMessage
};
