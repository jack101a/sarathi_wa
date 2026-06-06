const CONFIG = require('./config');
const authService = require('./authorizationService');
const authRepo = require('./authorizationRepository');
const rateLimiter = require('./rateLimiter');
const jobRepository = require('./jobRepository');
const { apiQueue, browserQueue } = require('./queue');
const serviceRepo = require('./serviceRepository');

// Commands that only read from stored data — skip concurrent job count check
const INSTANT_COMMANDS = new Set(['track_status', 'list_track']);
const INTERACTIVE_BROWSER_COMMANDS = new Set([
  'llprint_start',
  'lledit_start',
  'dl_renewal_start',
  'apply_dl_start',
  'pay_fee_start',
  'slot_booking_start',
  'mobupdate_start',
]);

function makeJobId() { return `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function getGroupContextId(message, transport, commandInfo = {}) {
  if (commandInfo.groupId) return String(commandInfo.groupId);
  const t = String(transport || '').toLowerCase();
  if (t === 'whatsapp') {
    const from = String(message && message.from || '');
    return from.endsWith('@g.us') ? from : '';
  }
  if (t === 'telegram') {
    const chat = message && message.chat;
    const type = String(chat && chat.type || '').toLowerCase();
    return type === 'group' || type === 'supergroup' ? String(chat.id) : '';
  }
  return '';
}

function getQueueType(command) {
  const registry = serviceRepo.getServiceRegistrySync();
  const entry = registry.get(command);
  return entry && entry.queue_type === 'browser' ? 'browser' : 'api';
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
  const plan      = user.plan_id || user.subscription_plan || 'free';
  const groupId   = getGroupContextId(message, transport, commandInfo);
  const rateCheck = await rateLimiter.checkRateLimit(user.id, plan, commandInfo.command, groupId);
  if (!rateCheck.allowed) {
    // Use the human-friendly message from rateLimiter if present
    const msg = rateCheck.message || `Rate limit reached: ${rateCheck.reason}. Please wait.`;
    return { blocked: true, reason: rateCheck.reason, message: msg };
  }

  // 4. Max concurrent jobs per user (skip for instant read-only commands)
  if (!INSTANT_COMMANDS.has(commandInfo.command)) {
    const activeCount = await rateLimiter.getActiveJobCount(user.id);
    let limits = CONFIG.RATE_LIMITS.standard;
    try {
      const [planRow] = await authRepo.query('SELECT limits_json FROM subscription_plans WHERE id = ?', [plan]);
      if (planRow && planRow.limits_json) {
        limits = typeof planRow.limits_json === 'string' ? JSON.parse(planRow.limits_json) : planRow.limits_json;
      }
    } catch (_) {}
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
  const payload = { ...(commandInfo.payload || {}) };
  let billing = null;

  if (rateLimiter.isHeavyCommand(commandInfo.command)) {
    const creditCost = await rateLimiter.getCreditCostForUser(user.id, plan, commandInfo.command, groupId);
    try {
      await authRepo.reserveCreditsForJob(user.id, creditCost, commandInfo.command, jobId);
      billing = { creditReserved: true, creditCost };
      payload.__billing = billing;
    } catch (err) {
      if (err && err.code === 'INSUFFICIENT_CREDITS') {
        return {
          blocked: true,
          reason: 'credit_balance',
          message: `⚠️ *Insufficient Credits*\n\nThis service costs *${creditCost} credits*. Your available balance is *${err.available} credits*.`,
        };
      }
      throw err;
    }
  }

  const payloadJson = JSON.stringify(payload);

  try {
    const createdJob = await jobRepository.createJob({
      id: jobId,
      userId: user.id,
      userPhone: user.canonical_phone,
      queueType,
      command: commandInfo.command,
      payloadJson,
      chatId: commandInfo.chatId,
      transport,
      dedupKey: commandInfo.dedupKey || jobId,
    });

    if (createdJob && createdJob.created === false) {
      if (billing && billing.creditReserved) {
        await authRepo.releaseReservedCreditsForJob(user.id, billing.creditCost, jobId).catch(() => {});
      }
      return { blocked: false, duplicate: true, jobId: createdJob.id };
    }

    const job = {
      id: jobId,
      command: commandInfo.command,
      payload_json: payloadJson,
      chat_id: commandInfo.chatId,
      transport,
      user_phone: user.canonical_phone,
      user_id: user.id,          // needed by jobQueue for credit deduction
      credit_reserved: Boolean(billing && billing.creditReserved),
      credit_cost: billing ? billing.creditCost : 0,
    };

    if (queueType === 'browser') {
      const options = { jobId: job.id };
      if (INTERACTIVE_BROWSER_COMMANDS.has(job.command)) {
        options.attempts = 1;
      }
      await browserQueue.add(job.command, job, options);
    } else {
      await apiQueue.add(job.command, job, { jobId: job.id });
    }
  } catch (err) {
    if (billing && billing.creditReserved) {
      await authRepo.releaseReservedCreditsForJob(user.id, billing.creditCost, jobId).catch(() => {});
    }
    throw err;
  }

  return { blocked: false, jobId };
}

module.exports = { processRequest, getQueueType };
