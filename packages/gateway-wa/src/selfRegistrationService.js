const {
  redis,
  authorizationRepository: authRepo,
  authorizationService,
  authorizationNormalizer,
} = require('@sarathi/common');
const { startVerification } = require('../../../src/services/waVerificationService');
const {
  isRegisterCommand,
  normalizeName,
  normalizeIndianMobile,
  outboundJidForMobile,
} = require('./selfRegistrationUtils');

const SESSION_TTL_SECONDS = 30 * 60;
const MAX_OTP_ATTEMPTS = 3;

function sessionKey(chatId) {
  return `wa:register:${chatId}`;
}

function isPrivateChat(message) {
  return Boolean(message && message.from && !String(message.from).endsWith('@g.us'));
}

async function getSession(chatId) {
  const raw = await redis.get(sessionKey(chatId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    await redis.del(sessionKey(chatId)).catch(() => {});
    return null;
  }
}

async function saveSession(chatId, session) {
  await redis.setex(sessionKey(chatId), SESSION_TTL_SECONDS, JSON.stringify(session));
}

async function clearSession(chatId) {
  await redis.del(sessionKey(chatId)).catch(() => {});
}

async function hasLinkedUser(message) {
  const user = await authorizationService.getUserForRequest(message, 'whatsapp');
  return Boolean(user);
}

async function getAnyUserByPhone(phone) {
  const rows = await authRepo.query(
    "SELECT *, COALESCE(plan_id, 'free') AS subscription_plan FROM auth_users WHERE canonical_phone = ? LIMIT 1",
    [phone]
  );
  return rows[0] || null;
}

async function linkCurrentIdentity(userId, phone, message) {
  const idContext = authorizationNormalizer.extractIdentityFromMessage(message);
  const identities = [...new Set((idContext && idContext.identities) || [])];

  for (const value of identities) {
    if (!value) continue;
    const existing = await authRepo.getIdentity(value);
    if (existing) continue;
    let type = 'wa_other';
    if (value.endsWith('@lid')) type = 'wa_lid';
    else if (value.endsWith('@c.us') || value.endsWith('@s.whatsapp.net')) type = 'wa_cus';
    await authRepo.createUserIdentity(userId, type, value);
  }

  const canonicalCus = outboundJidForMobile(phone);
  const canonicalExists = await authRepo.getIdentity(canonicalCus);
  if (!canonicalExists) {
    await authRepo.createUserIdentity(userId, 'wa_cus', canonicalCus);
  }
}

async function cancelOtherPendingVerifications(phone, verifiedId) {
  const rows = await authRepo.query(
    "SELECT id FROM auth_verifications WHERE canonical_phone = ? AND status = 'pending' AND id != ?",
    [phone, verifiedId]
  );
  for (const row of rows) {
    await authRepo.updateVerificationStatus(row.id, 'cancelled', '');
  }
}

async function isSenderPreRegistered(message) {
  const pureSender = authorizationService.getWhatsAppSenderId(message);
  if (!pureSender) return false;

  let existing = await getAnyUserByPhone(pureSender);
  if (existing) return true;

  if (pureSender.length > 10) {
    const short10 = pureSender.slice(-10);
    existing = await getAnyUserByPhone(short10);
    if (existing) return true;
  }

  return false;
}

async function startRegistration(message) {
  if (await hasLinkedUser(message)) {
    await message.reply('You are already registered. Send *help* to continue.');
    return { handled: true };
  }

  await saveSession(message.from, {
    step: 'await_name',
    attempts: 0,
    startedAt: Date.now(),
  });
  await message.reply('Welcome to Sarathi Bot.\n\nPlease enter your full name to register.');
  return { handled: true };
}

async function handleNameStep(message, text, session) {
  const name = normalizeName(text);
  if (name.length < 2) {
    await message.reply('Please enter a valid full name.');
    return { handled: true };
  }

  await saveSession(message.from, { ...session, step: 'await_mobile', name });
  await message.reply('Please enter your 10-digit WhatsApp mobile number.');
  return { handled: true };
}

async function handleMobileStep(client, message, text, session) {
  const phone = normalizeIndianMobile(text);
  if (!phone) {
    await message.reply('Please enter a valid 10-digit Indian WhatsApp mobile number.');
    return { handled: true };
  }

  const existing = await getAnyUserByPhone(phone);
  if (!existing) {
    await clearSession(message.from);
    return { handled: true };
  }

  if (Number(existing.is_active) !== 1) {
    await clearSession(message.from);
    await message.reply('This mobile number is inactive. Please contact admin to reactivate your account.');
    return { handled: true };
  }

  const verification = await startVerification(phone, 'self_register', 'self_register');
  if (!verification || !verification.code) {
    await message.reply('Could not generate OTP right now. Please try /register again later.');
    await clearSession(message.from);
    return { handled: true };
  }

  const targetJid = outboundJidForMobile(phone);
  const otpText =
    `Sarathi Bot registration OTP\n\n` +
    `Your verification code is: *${verification.code}*\n\n` +
    `Reply to Sarathi Bot with this 8-character code to complete registration.`;

  try {
    await client.sendMessage(targetJid, otpText);
  } catch (err) {
    await clearSession(message.from);
    await message.reply('Could not send OTP to that WhatsApp number. Please check the number and send /register again.');
    return { handled: true };
  }

  await saveSession(message.from, {
    ...session,
    step: 'await_otp',
    phone,
    verificationId: verification.id,
    attempts: 0,
  });
  await message.reply('We sent an OTP to your WhatsApp mobile number.\n\nPlease reply here with the 8-character code.');
  return { handled: true };
}

async function handleOtpStep(message, text, session) {
  const code = String(text || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    await message.reply('Please reply with the 8-character OTP code.');
    return { handled: true };
  }

  const verification = await authRepo.getPendingVerification(session.phone, code);
  if (!verification) {
    const attempts = Number(session.attempts || 0) + 1;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await clearSession(message.from);
      await message.reply('Too many wrong OTP attempts. Please send /register again.');
      return { handled: true };
    }
    await saveSession(message.from, { ...session, attempts });
    await message.reply(`Invalid OTP. Please try again. Attempts left: ${MAX_OTP_ATTEMPTS - attempts}`);
    return { handled: true };
  }

  await authRepo.updateVerificationStatus(verification.id, 'verified', message.from);
  await cancelOtherPendingVerifications(session.phone, verification.id);

  const existingAny = await getAnyUserByPhone(session.phone);
  if (existingAny && Number(existingAny.is_active) !== 1) {
    await clearSession(message.from);
    await message.reply('This mobile number is inactive. Please contact admin to reactivate your account.');
    return { handled: true };
  }

  let user = await authRepo.getUserByPhone(session.phone);
  if (!user) {
    user = await authRepo.createUser(session.phone, 'wa');
    await authRepo.updateUserProfile(session.phone, {
      name: session.name,
      plan_id: 'free',
      is_active: 1,
    });
    user = await authRepo.getUserByPhone(session.phone);
  } else if (session.name) {
    await authRepo.updateUserProfile(session.phone, { name: session.name, is_active: 1 });
    user = await authRepo.getUserByPhone(session.phone);
  }

  await linkCurrentIdentity(user.id, session.phone, message);
  await clearSession(message.from);
  await message.reply(
    'Registration successful.\n\n' +
    'Examples:\n' +
    '- help\n' +
    '- track <application number>'
  );
  return { handled: true };
}

async function handleIncoming(client, message, text) {
  if (!isPrivateChat(message)) {
    if (isRegisterCommand(text)) {
      await message.reply('Registration is available only in private chat. Please message the bot directly with /register.');
      return { handled: true };
    }
    return { handled: false };
  }

  if (/^\/cancel\b/i.test(String(text || '').trim())) {
    const existing = await getSession(message.from);
    if (existing) {
      await clearSession(message.from);
      await message.reply('Registration cancelled. Send /register to start again.');
      return { handled: true };
    }
  }

  const existingSession = await getSession(message.from);
  if (!existingSession && !isRegisterCommand(text)) {
    return { handled: false };
  }

  if (isRegisterCommand(text)) {
    const isPreRegistered = await isSenderPreRegistered(message);
    if (!isPreRegistered) {
      return { handled: false };
    }
    return startRegistration(message);
  }

  if (existingSession.step === 'await_name') {
    return handleNameStep(message, text, existingSession);
  }
  if (existingSession.step === 'await_mobile') {
    return handleMobileStep(client, message, text, existingSession);
  }
  if (existingSession.step === 'await_otp') {
    return handleOtpStep(message, text, existingSession);
  }

  await clearSession(message.from);
  return { handled: false };
}

module.exports = {
  handleIncoming,
};
