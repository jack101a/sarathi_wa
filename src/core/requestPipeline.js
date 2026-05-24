const CONFIG = require('../config/config');
const authService = require('../services/authorizationService');
const authRepo = require('../services/authorizationRepository');
const rateLimiter = require('./rateLimiter');
const jobRepository = require('../services/jobRepository');
const { apiQueue, browserQueue } = require('./jobQueue');

// Commands that only read from stored data — skip concurrent job count check
const INSTANT_COMMANDS = new Set(['track_status', 'list_track']);

function makeJobId() { return `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function getQueueType(command) {
  const browserCommands = [
    'llprint_start',
    'lledit_start',
    'dl_renewal_start',
    'apply_dl_start',
    'pay_fee_start',
    'slot_booking_start',
    'fee_print_start',
    'resend_otp',
    'dl_info_start',
  ];
  return browserCommands.includes(command) ? 'browser' : 'api';
}

async function processRequest(message, transport, commandInfo) {
  // 1. Identify user
  const user = await authService.getUserForRequest(message, transport);
  if (!user) return { blocked: true, reason: 'unregistered', message: 'You are not registered. Contact admin.' };

  // 2. Check subscription validity (active + not expired)
  const allowed = authService.isUserAllowed(user);
  if (!allowed.allowed) {
    if (allowed.reason === 'expired')  return { blocked: true, reason: 'expired',  message: 'Your subscription has expired. Contact admin.' };
    if (allowed.reason === 'inactive') return { blocked: true, reason: 'inactive', message: 'Your account is inactive. Contact admin.' };
    return { blocked: true, reason: 'denied', message: 'Access denied.' };
  }

  // 3. Rate / credit limit check (3-category: light / medium / heavy)
  const plan      = user.subscription_plan || 'standard';
  const rateCheck = await rateLimiter.checkRateLimit(user.id, plan, commandInfo.command);
  if (!rateCheck.allowed) {
    // Use the human-friendly message from rateLimiter if present
    const msg = rateCheck.message || `Rate limit reached: ${rateCheck.reason}. Please wait.`;
    return { blocked: true, reason: rateCheck.reason, message: msg };
  }

  // 4. Max concurrent jobs per user (skip for instant read-only commands)
  if (!INSTANT_COMMANDS.has(commandInfo.command)) {
    const activeCount = await rateLimiter.getActiveJobCount(user.id);
    const limits      = CONFIG.RATE_LIMITS[plan] || CONFIG.RATE_LIMITS.standard;
    if (activeCount >= limits.maxConcurrent) {
      return {
        blocked: true,
        reason: 'concurrent_limit',
        message: `⏳ You already have ${activeCount} job(s) running. Please wait for them to finish before starting a new one.`,
      };
    }
  }

  // 5. Create job record + enqueue
  const queueType   = getQueueType(commandInfo.command);
  const jobId       = makeJobId();
  const payloadJson = JSON.stringify(commandInfo.payload || {});

  await jobRepository.createJob({
    id: jobId,
    userId: user.id,
    userPhone: user.canonical_phone,
    queueType,
    command: commandInfo.command,
    payloadJson,
    chatId: commandInfo.chatId,
    transport,
  });

  const job = {
    id: jobId,
    command: commandInfo.command,
    payload_json: payloadJson,
    chat_id: commandInfo.chatId,
    transport,
    user_phone: user.canonical_phone,
    user_id: user.id,          // needed by jobQueue for credit deduction
  };

  if (queueType === 'browser') browserQueue.enqueue(job);
  else                          apiQueue.enqueue(job);

  return { blocked: false, jobId };
}

module.exports = { processRequest, getQueueType };
