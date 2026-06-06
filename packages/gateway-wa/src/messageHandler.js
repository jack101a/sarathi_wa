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
const { consumeVerificationMessage, resendVerification } = require('../../../src/services/waVerificationService');
const { handleAuthCommand } = require('../../../src/commands/authAdmin');
const selfRegistrationService = require('./selfRegistrationService');
const {
  handleIncomingText: handleVahanIncomingText,
  hasActiveSession: hasActiveVahanSession,
  stopSession: stopVahanSession,
} = require('../../../src/services/vahanService');

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

function isChatIdCommand(text) {
  return /^\/?send(?:_|\s+)chatid\b/i.test(String(text || '').trim());
}

function getChatIdReplyText(message) {
  const sender = message.from || '';
  const author = message.author || '';
  const isGroup = /@g\.us$/i.test(sender);
  const lines = [
    'Chat ID details:',
    `chat_id: ${sender || '-'}`,
  ];
  if (isGroup) {
    lines.push('type: group');
    if (author) lines.push(`sender_id: ${author}`);
  } else {
    lines.push('type: private');
  }
  return lines.join('\n');
}

function makeVahanWhatsAppClient(client) {
  return {
    sendText: async (chatId, text) => client.sendMessage(chatId, text),
    sendImage: async (chatId, imagePath, caption) => {
      const { MessageMedia } = require('whatsapp-web.js');
      const media = MessageMedia.fromFilePath(imagePath);
      await client.sendMessage(chatId, media, { caption });
    },
  };
}

async function forwardToVahanIfActive(client, message, text) {
  if (!hasActiveVahanSession(message.from, 'whatsapp')) {
    return false;
  }
  if (!text && message.hasMedia) {
    return true;
  }
  await handleVahanIncomingText(makeVahanWhatsAppClient(client), message.from, text, 'whatsapp');
  return true;
}

function startsBrowserCommand(text) {
  return /^\/?(?:llprint|lledit|payfee|feeprint|fees|dlrenewal|renewal|duplicate|replacement|dlextract|dlapp|bookslot|mobupdate)\b/i.test(String(text || '').trim());
}

async function forwardInteractiveInputIfAny(message, text) {
  const sessionKey = `session:otp:${message.from}`;
  const sessionRaw = await redis.get(sessionKey);
  if (!sessionRaw || startsBrowserCommand(text)) {
    return false;
  }

  const session = JSON.parse(sessionRaw);
  const input = String(text || '').trim();
  if (!input) {
    return false;
  }

  if (/^(?:stop|cancel)$/i.test(input)) {
    await redis.publish(`otp:input:${session.jobId}`, input);
    await redis.del(sessionKey).catch(() => {});
    await message.reply('✅ Pending session stopped.');
    return true;
  }

  await redis.publish(`otp:input:${session.jobId}`, input);
  const status = String(session.status || '');
  if (status.includes('payment')) {
    await message.reply('Payment confirmation received. Processing...');
  } else if (status.includes('slot')) {
    await message.reply('Slot choice received. Processing...');
  } else if (status.includes('aadhaar') || status.includes('mobile')) {
    // The mobile-update worker immediately sends the next prompt or final result.
  } else {
    await message.reply('OTP received. Processing...');
  }
  return true;
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

function getPrivatePhoneCandidates(message) {
  const idContext = authorizationNormalizer.extractIdentityFromMessage(message);
  const identities = (idContext && idContext.identities) || [];
  const candidates = [];

  for (const identity of identities) {
    const text = String(identity || '').toLowerCase();
    if (!text.endsWith('@c.us') && !text.endsWith('@s.whatsapp.net')) {
      continue;
    }
    const digits = text.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!digits) continue;
    candidates.push(digits);
    if (digits.length > 10) candidates.push(digits.slice(-10));
  }

  return [...new Set(candidates)];
}

async function hasLinkedCurrentIdentity(message) {
  const idContext = authorizationNormalizer.extractIdentityFromMessage(message);
  const identities = (idContext && idContext.identities) || [];
  for (const identity of identities) {
    const row = await authRepo.getIdentity(identity);
    if (row && row.auth_user_id) return true;
  }
  return false;
}

async function findActiveUserFromPhoneCandidates(candidates) {
  for (const phone of candidates) {
    const user = await authRepo.getUserByPhone(phone);
    if (user && Number(user.is_active) === 1) return user;
  }
  return null;
}

async function maybeSendPairingCodeForKnownPhone(message) {
  if (!message || String(message.from || '').endsWith('@g.us')) return false;
  if (await hasLinkedCurrentIdentity(message)) return false;

  const candidates = getPrivatePhoneCandidates(message);
  if (!candidates.length) return false;

  const user = await findActiveUserFromPhoneCandidates(candidates);
  if (!user) return false;

  const throttleKey = `wa:repair:${user.id}:${message.from}`;
  const allowed = await redis.set(throttleKey, '1', 'EX', 300, 'NX').catch(() => null);
  if (allowed !== 'OK') {
    await message.reply('Your WhatsApp account needs to be linked again. Please use the latest activation code already sent, or ask admin to resend it.');
    return true;
  }

  const verif = await resendVerification(user.canonical_phone);
  if (!verif) return false;

  await message.reply(`Your WhatsApp identity changed or is not linked yet.\n\nReply with this 8-character code to link this WhatsApp account: *${verif.code}*`);
  return true;
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
    const isAdmin = authorizationService.isAdminWhatsApp(message, CONFIG);

    if (!isAdmin) {
      const registrationResult = await selfRegistrationService.handleIncoming(client, message, normalizedBody);
      if (registrationResult && registrationResult.handled) {
        return;
      }
    }

    const compactCode = normalizedBody.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const isVerificationFormat = /^(?:auth\s+\d+\s+[a-z0-9]{6,8})$/i.test(normalizedBody) || /^[A-Z0-9]{8}$/.test(compactCode);
    if (isVerificationFormat) {
      const idContext = authorizationNormalizer.extractIdentityFromMessage(message);
      const ok = await consumeVerificationMessage(normalizedBody, idContext);
      console.log(`[MessageHandler] Verification code attempt from=${maskChatId(message.from)} matched=${ok}`);
      if (ok) {
        await message.reply('✅ Verification successful! Your WhatsApp account has been activated and linked.\n\nSend *help* to see how to use Sarathi Bot.');
        return;
      }
    }

    if (!isAdmin && await maybeSendPairingCodeForKnownPhone(message)) {
      return;
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

    if (isChatIdCommand(normalizedBody)) {
      await message.reply(getChatIdReplyText(message));
      return;
    }

    const dbUser = await authorizationService.getUserForRequest(message, 'whatsapp');

    if (/^\/?auth\b/i.test(normalizedBody)) {
      if (!isAdmin) {
        return;
      }
      const reply = await handleAuthCommand(normalizedBody, message.from, client);
      if (reply) {
        await message.reply(reply);
        return;
      }
    }

    // 3. Check Redis for active browser-worker interactive session.
    // The key name is historical: it is also used for payment, slot, Aadhaar,
    // and mobile-update inputs, not only OTP codes.
    if (await forwardInteractiveInputIfAny(message, normalizedBody)) {
      return;
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
        if (result.duplicate) {
          return;
        }
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
            if (result.duplicate) {
              return;
            }
            if (result.blocked) {
              await message.reply(`🚫 ${result.message}`);
            } else {
              await message.reply('⏳ Processing...');
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
      await forwardToVahanIfActive(client, message, normalizedBody);
      return;
    }

    if (normResult.silent) {
      return;
    }

    if (normResult.success === false) {
      if (normResult.error) {
        await message.reply(normResult.error);
        return;
      }
      await forwardToVahanIfActive(client, message, normalizedBody);
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
      if (hasActiveVahanSession(message.from, 'whatsapp')) {
        await stopVahanSession(message.from, 'whatsapp');
        await message.reply('Vahan session stopped.');
        return;
      }
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

    if (result.duplicate) {
      return;
    }

    if (result.blocked) {
      await message.reply(`🚫 ${result.message}`);
    } else {
      await message.reply('⏳ Processing...');
    }

  } catch (error) {
    console.error(`[MessageHandler] Error handling message: ${error.stack}`);
    await message.reply('❌ Something went wrong. Please try again later.');
  }
}

module.exports = {
  handleIncomingMessage
};
