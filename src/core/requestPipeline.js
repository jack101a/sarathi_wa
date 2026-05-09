const CONFIG = require('../config/config');
const authService = require('../services/authorizationService');
const authRepo = require('../services/authorizationRepository');
const rateLimiter = require('./rateLimiter');
const jobRepository = require('../services/jobRepository');
const { apiQueue, browserQueue } = require('./jobQueue');

// Commands that only read from stored data — never block on concurrent job count
const INSTANT_COMMANDS = new Set(['track_status', 'list_track']);

function makeJobId() { return `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function getQueueType(command) {
  const browserCommands = ['appl_pdf', 'appl_image', 'llprint_start'];
  return browserCommands.includes(command) ? 'browser' : 'api';
}

async function processRequest(message, transport, commandInfo) {
  const user = await authService.getUserForRequest(message, transport);
  const isAdmin = authService.isAdminIdentity(message, transport, CONFIG);

  // ── Identify effective user for tracking ──
  const userId = user ? user.id : (isAdmin ? 'admin' : null);
  const userPhone = user ? user.canonical_phone : (isAdmin && transport === 'whatsapp' ? authService.getWhatsAppSenderId(message) : (isAdmin ? 'admin' : null));

  // ── Ensure llprint_start always uses the correct 10-digit mobile number ──
  if (commandInfo.command === 'llprint_start') {
    if (user && user.canonical_phone) {
      commandInfo.payload.mobile = user.canonical_phone;
    } else if (transport === 'whatsapp') {
      const raw = authService.getWhatsAppSenderId(message);
      // If it looks like a phone number (not @lid), take last 10 digits
      if (raw && !raw.includes('@') && raw.replace(/\D/g, '').length >= 10) {
        commandInfo.payload.mobile = raw.replace(/\D/g, '').slice(-10);
      }
    }
  }

  // ── Admin fast-path ───────────────────────────────────────────────────────
  if (isAdmin) {
    const queueType = getQueueType(commandInfo.command);
    const jobId = makeJobId();
    const payloadJson = JSON.stringify(commandInfo.payload || {});
    await jobRepository.createJob({
      id: jobId,
      userId: userId || 'admin',
      userPhone: userPhone || 'admin',
      queueType,
      command: commandInfo.command,
      payloadJson,
      chatId: commandInfo.chatId,
      transport,
    });
    const job = { id: jobId, command: commandInfo.command, payload_json: payloadJson, chat_id: commandInfo.chatId, transport, user_phone: userPhone || 'admin' };
    if (queueType === 'browser') browserQueue.enqueue(job); else apiQueue.enqueue(job);
    return { blocked: false, jobId, isAdmin: true };
  }

  // ── Normal user path ──────────────────────────────────────────────────────
  if (!user) return { blocked: true, reason: 'unregistered', message: 'You are not registered. Contact admin.' };

  const allowed = authService.isUserAllowed(user);
  if (!allowed.allowed) {
    if (allowed.reason === 'expired') return { blocked: true, reason: 'expired', message: 'Your subscription has expired. Contact admin.' };
    if (allowed.reason === 'inactive') return { blocked: true, reason: 'inactive', message: 'Your account is inactive. Contact admin.' };
    return { blocked: true, reason: 'denied', message: 'Access denied.' };
  }

  const plan = user.subscription_plan || 'free';
  const rateCheck = await rateLimiter.checkRateLimit(user.id, plan);
  if (!rateCheck.allowed) return { blocked: true, reason: 'rate_limit', message: `Rate limit reached: ${rateCheck.reason}. Please wait.` };

  if (!INSTANT_COMMANDS.has(commandInfo.command)) {
    const activeCount = await rateLimiter.getActiveJobCount(user.id);
    const limits = CONFIG.RATE_LIMITS[plan] || CONFIG.RATE_LIMITS.free;
    if (activeCount >= limits.maxConcurrent) return { blocked: true, reason: 'concurrent_limit', message: 'You already have jobs running. Please wait for them to finish.' };
  }

  const queueType = getQueueType(commandInfo.command);
  const jobId = makeJobId();
  const payloadJson = JSON.stringify(commandInfo.payload || {});

  await jobRepository.createJob({ id: jobId, userId: user.id, userPhone: user.canonical_phone, queueType, command: commandInfo.command, payloadJson, chatId: commandInfo.chatId, transport });
  await authRepo.incrementUsage(user.id);
  await rateLimiter.recordRequest(user.id, commandInfo.command);

  const job = { id: jobId, command: commandInfo.command, payload_json: payloadJson, chat_id: commandInfo.chatId, transport, user_phone: user.canonical_phone };
  if (queueType === 'browser') browserQueue.enqueue(job); else apiQueue.enqueue(job);
  return { blocked: false, jobId };
}

module.exports = { processRequest, getQueueType };
