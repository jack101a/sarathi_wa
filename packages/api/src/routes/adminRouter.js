const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { 
  db, 
  redis, 
  subscriber,
  config: CONFIG, 
  logger, 
  chatNotifier,
  authorizationRepository: authRepo,
  authorizationService: authService,
  jobRepository,
  planRepository,
  serviceRepository,
  trackingRepository,
  queue
} = require('@sarathi/common');

const { apiQueue, browserQueue } = queue;
const { handleLogin, handleLogout, handleVerify, requireAdminAuth } = require('../middleware/adminAuth');

// Heavy refresh still uses the command services, but tracking storage is Postgres-backed.
const { refreshAllTrackedApplications } = require('../../../../src/services/trackingControlService');

// Helper to get BullMQ queue stats
async function getQueueStats(q) {
  try {
    const [pending, active, completed, failed] = await Promise.all([
      q.getJobCountByTypes('waiting', 'delayed'),
      q.getJobCountByTypes('active'),
      q.getJobCountByTypes('completed'),
      q.getJobCountByTypes('failed'),
    ]);
    return {
      name: q.name,
      pending,
      running: active,
      completed,
      failed
    };
  } catch (err) {
    return { name: q.name, pending: 0, running: 0, completed: 0, failed: 0 };
  }
}

// Helper to cancel a pending job in BullMQ
async function cancelQueueJob(q, jobId) {
  try {
    const job = await q.getJob(jobId);
    if (job) {
      await job.remove();
      return true;
    }
  } catch (_) {}
  return false;
}

// ── Public routes (no auth required) ──────────────────────────────────────
router.post('/login', handleLogin);
router.post('/logout', handleLogout);

/**
 * Razorpay Webhook — auto-credits user when QR payment is received.
 * MUST be before requireAdminAuth since Razorpay calls this without cookies.
 * Uses express.raw() to preserve raw body for HMAC signature verification.
 */
router.post('/payments/razorpay/webhook',
  async (req, res) => {
    const { razorpayService } = require('@sarathi/common');
    const sig = req.headers['x-razorpay-signature'] || '';
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

    // 1. Verify signature
    if (!razorpayService.verifyWebhookSignature(rawBody, sig)) {
      logger.warn('razorpay', 'Webhook signature verification FAILED');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    } catch (err) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const eventName = event.event || '';
    logger.info('razorpay', `Webhook received: ${eventName}`);

    // 2. Handle payment captured on a QR code
    if (eventName === 'payment.captured' || eventName === 'qr_code.credited') {
      try {
        const payment  = event.payload?.payment?.entity || event.payload?.qr_code?.entity || {};
        const notes    = payment.notes || {};
        const userId   = notes.user_id;
        const chatId   = notes.chat_id;
        const transport = notes.transport || 'whatsapp';
        const amount   = parseInt(notes.amount || payment.amount / 100, 10);

        if (!userId || !chatId || isNaN(amount) || amount <= 0) {
          logger.warn('razorpay', 'Webhook missing user_id/chat_id/amount in notes', notes);
          return res.status(200).json({ status: 'ok_ignored' });
        }

        // Idempotency: use payment ID as dedup key
        const paymentId = payment.id || '';
        if (paymentId) {
          const already = await redis.set(`razorpay:processed:${paymentId}`, '1', 'EX', 86400, 'NX');
          if (!already) {
            logger.info('razorpay', `Duplicate webhook for payment ${paymentId} — skipped`);
            return res.status(200).json({ status: 'ok_duplicate' });
          }
        }

        // Credit the user
        const user = await authRepo.getUserById(userId);
        if (!user) {
          logger.warn('razorpay', `User not found: ${userId}`);
          return res.status(200).json({ status: 'ok_user_not_found' });
        }

        await authRepo.addCreditsAudited(userId, amount, `Razorpay auto-topup ₹${amount} (${paymentId})`, 'razorpay');
        logger.info('razorpay', `Credited ${amount} credits to user ${userId} (${user.canonical_phone})`);

        // Notify user via Redis (gateway picks this up and sends WhatsApp/TG message)
        const responseChannel = `chat:response:${transport}:${chatId}`;
        await redis.publish(responseChannel, JSON.stringify({
          type: 'text',
          text:
            `✅ *₹${amount} का भुगतान प्राप्त हुआ!*\n\n` +
            `🎉 *${amount} क्रेडिट* आपके खाते में जोड़ दिए गए हैं।\n` +
            `💰 नया बैलेंस देखने के लिए \`balance\` टाइप करें।`,
        }));

        // Discord alert
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (webhookUrl) {
          const { chatNotifier } = require('@sarathi/common');
          await chatNotifier.sendDiscordAlert(
            '💰 Razorpay Auto-Topup',
            `**User:** ${user.name || user.canonical_phone}\n**Amount:** ₹${amount}\n**Payment ID:** ${paymentId}`,
            'success'
          ).catch(() => {});
        }
      } catch (err) {
        logger.error('razorpay', `Webhook processing error: ${err.message}`);
        // Still respond 200 so Razorpay doesn't retry
      }
    }

    return res.status(200).json({ status: 'ok' });
  }
);

/** Verify current session */
router.get('/verify', requireAdminAuth, handleVerify);

// ─── Protected routes ───────────────────────────────────────────────────────
router.use(requireAdminAuth);


// ── Bootstrap (loads everything the dashboard needs) ──────────────────────
router.get('/bootstrap', async (req, res) => {
  try {
    const [users, waGroups, tgGroups, totalCreditsSpent, services, apiStats, browserStats] = await Promise.all([
      authRepo.getUsersWithSpentCredits(),
      authRepo.getAuthorizedGroups('wa'),
      authRepo.getAuthorizedGroups('tg'),
      authRepo.getTotalCreditsSpent(),
      serviceRepository.getAllServices(),
      getQueueStats(apiQueue),
      getQueueStats(browserQueue),
    ]);

    const sarathi = await trackingRepository.listByType('sarathi');
    const vahan = await trackingRepository.listByType('vahan');
    const jobs = await jobRepository.getPendingJobs('api', 20);
    const jobStats = await authRepo.getJobStats();
    const totalCredits = await authRepo.getTotalCredits();

    res.json({
      ok: true,
      stats: {
        totalUsers: users.length,
        activeUsers: users.filter(u => Number(u.is_active) === 1).length,
        sarathiTracked: sarathi.length,
        vahanTracked: vahan.length,
        pendingJobs: apiStats.pending + browserStats.pending,
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        totalCredits,
        totalCreditsSpent,
        jobsToday: jobStats.todayCount,
        successRate: jobStats.successRate,
      },
      users,
      services,
      waGroups,
      tgGroups,
      sarathiTracked: sarathi,
      vahanTracked: vahan,
      recentJobs: jobs,
      queues: {
        api: apiStats,
        browser: browserStats,
      },
      rateLimitConfig: {
        plans: CONFIG.RATE_LIMITS,
        creditCost: CONFIG.CREDIT_COST,
      },
    });
  } catch (err) {
    logger.error('adminRouter', 'Bootstrap failed', { error: err.stack });
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Subscription Plans ───────────────────────────────────────────────────────
router.get('/plans', async (req, res) => {
  try {
    const plans = await planRepository.getAllPlans();
    res.json({ ok: true, plans });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.post('/plans', async (req, res) => {
  try {
    const plan = await planRepository.createPlan(req.body);
    logger.info('adminRouter', 'Plan created', { id: plan.id });
    res.json({ ok: true, plan });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.put('/plans/:id', async (req, res) => {
  try {
    const plan = await planRepository.updatePlan(req.params.id, req.body);
    logger.info('adminRouter', 'Plan updated', { id: plan.id });
    res.json({ ok: true, plan });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.delete('/plans/:id', async (req, res) => {
  try {
    await planRepository.deletePlan(req.params.id);
    logger.info('adminRouter', 'Plan deleted', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Services ────────────────────────────────────────────────────────────────
router.get('/services', async (req, res) => {
  try {
    const services = await serviceRepository.getAllServices();
    res.json({ ok: true, services });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.post('/services', async (req, res) => {
  try {
    const service = await serviceRepository.createService(req.body);
    logger.info('adminRouter', 'Service created', { id: service.id });
    res.json({ ok: true, service });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.put('/services/:id', async (req, res) => {
  try {
    const service = await serviceRepository.updateService(req.params.id, req.body);
    logger.info('adminRouter', 'Service updated', { id: service.id });
    res.json({ ok: true, service });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

router.delete('/services/:id', async (req, res) => {
  try {
    const planRows = await planRepository.getAllPlans();
    const referencedPlans = planRows.filter(p => Array.isArray(p.services) && p.services.includes(req.params.id));

    if (referencedPlans.length > 0) {
      return res.status(400).json({
        ok: false,
        message: `Cannot delete service because it is explicitly assigned in subscription plans: ${referencedPlans.map(p => p.name).join(', ')}`
      });
    }

    await serviceRepository.deleteService(req.params.id);
    logger.info('adminRouter', 'Service deleted', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Users ──────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const users = await authRepo.getUsersWithSpentCredits();
    res.json({ ok: true, users });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { phone, channel = 'wa', name = '', plan = 'standard', monthly_limit = 0, expiry_date = '' } = req.body || {};
    if (!phone) return res.status(400).json({ ok: false, message: 'phone is required' });
    
    const user = await authService.addAuthorizedEntry(channel, 'user', phone, { name, plan, monthly_limit, expiry_date });
    logger.info('adminRouter', 'User created', { phone, channel });

    let verificationCode = null;

    if (channel === 'wa' || channel === 'whatsapp') {
      const waVerificationService = require('../../../../src/services/waVerificationService');
      
      const verif = await waVerificationService.startVerification(phone, 'admin', 'wa');
      if (verif) {
        verificationCode = verif.code;
        const digits = String(phone).trim().replace(/\D/g, '');
        const targetJid = digits.endsWith('@c.us') ? digits : `${digits}@c.us`;
        const messageText = `Welcome to Sarathi Bot! 🚀\n\nYour account activation code is: *${verificationCode}*\n\nPlease reply directly to this chat with this 8-digit code to activate and link your WhatsApp account.`;
        
        try {
          await chatNotifier.sendWhatsAppText(targetJid, messageText);
          logger.info('adminRouter', `Outbound activation WhatsApp code sent to ${targetJid}`);
        } catch (sendErr) {
          logger.error('adminRouter', `Failed to send outbound activation WhatsApp message to ${targetJid}`, { error: sendErr.message });
        }
      }
    }

    res.json({ ok: true, user, code: verificationCode });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.patch('/users/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const updates = req.body || {};
    await authRepo.updateUserProfile(phone, updates);
    logger.info('adminRouter', 'User updated', { phone, updates });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/users/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    await authRepo.deactivateUser(phone);
    logger.info('adminRouter', 'User deactivated', { phone });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/users/:phone/resend-activation', async (req, res) => {
  try {
    const { phone } = req.params;
    const waVerificationService = require('../../../../src/services/waVerificationService');
    
    const verif = await waVerificationService.resendVerification(phone);
    if (!verif) {
      return res.status(400).json({ ok: false, message: 'Failed to generate verification code' });
    }
    
    const digits = String(phone).trim().replace(/\D/g, '');
    const targetJid = digits.endsWith('@c.us') ? digits : `${digits}@c.us`;
    const messageText = `Sarathi Bot Activation Code 🚀\n\nYour new account activation code is: *${verif.code}*\n\nPlease reply directly to this chat with this 8-digit code to activate and link your WhatsApp account.`;
    
    try {
      await chatNotifier.sendWhatsAppText(targetJid, messageText);
      logger.info('adminRouter', `Resent activation WhatsApp code to ${targetJid}`);
      res.json({ ok: true, code: verif.code });
    } catch (sendErr) {
      logger.error('adminRouter', `Failed to resend activation WhatsApp message to ${targetJid}`, { error: sendErr.message });
      res.json({ ok: true, code: verif.code, warning: 'Failed to send outbound WhatsApp message' });
    }
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── User Credits (audited) ────────────────────────────────────────────────
router.post('/users/:phone/credits', async (req, res) => {
  try {
    const { phone } = req.params;
    const { action, amount, note = '' } = req.body || {};
    if (!action || !['add', 'deduct', 'set'].includes(action)) return res.status(400).json({ ok: false, message: "action must be 'add', 'deduct' or 'set'" });
    
    const numAmount = Number(amount);
    if (isNaN(numAmount)) return res.status(400).json({ ok: false, message: 'amount must be a valid number' });
    if (action === 'set') {
      if (numAmount < 0) return res.status(400).json({ ok: false, message: 'amount must be non-negative for set exact' });
    } else {
      if (numAmount <= 0) return res.status(400).json({ ok: false, message: 'amount must be positive' });
    }

    const user = await authRepo.getUserByPhone(phone);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    
    let result;
    if (action === 'add') result = await authRepo.addCreditsAudited(user.id, numAmount, note, 'admin');
    else if (action === 'deduct') result = await authRepo.deductCreditsAudited(user.id, numAmount, note, '');
    else result = await authRepo.setCreditsAudited(user.id, numAmount, note, 'admin');
    
    logger.info('adminRouter', `Credits ${action}`, { phone, amount: numAmount, newBalance: result.newBalance });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/users/:phone/credit-history', async (req, res) => {
  try {
    const { phone } = req.params;
    const user = await authRepo.getUserByPhone(phone);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const history = await authRepo.getCreditHistory(user.id, limit);
    res.json({ ok: true, history });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/users/:phone/logs', async (req, res) => {
  try {
    const { phone } = req.params;
    const user = await authRepo.getUserByPhone(phone);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const [credits, jobs] = await Promise.all([
      authRepo.getCreditHistory(user.id, limit),
      db.query('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [user.id, limit])
    ]);
    res.json({ ok: true, credits, jobs });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── User Rate Limit Overrides ─────────────────────────────────────────────
router.patch('/users/:phone/rate-overrides', async (req, res) => {
  try {
    const { phone } = req.params;
    const overrides = req.body || {};
    const user = await authRepo.getUserByPhone(phone);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    await authRepo.setUserRateOverrides(user.id, overrides);
    logger.info('adminRouter', 'Rate overrides set', { phone, overrides });
    res.json({ ok: true, overrides });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Rate Limits Config ────────────────────────────────────────────────────
router.get('/rate-limits/config', (req, res) => {
  res.json({
    ok: true,
    plans: CONFIG.RATE_LIMITS,
    creditCost: CONFIG.CREDIT_COST,
    queue: {
      apiConcurrency: CONFIG.QUEUE.API_CONCURRENCY,
      browserConcurrency: CONFIG.QUEUE.BROWSER_CONCURRENCY,
    },
  });
});

router.get('/rate-limits/usage/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const now = Date.now();
    const dayAgo   = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [lightDay]  = await db.query("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light'", [userId, dayAgo]);
    const [medDay]    = await db.query("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium'", [userId, dayAgo]);
    const [heavyDay]  = await db.query("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='heavy'", [userId, dayAgo]);
    const [lightMon]  = await db.query("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light'", [userId, monthAgo]);
    const [medMon]    = await db.query("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium'", [userId, monthAgo]);
    const [heavyMon]  = await db.query("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='heavy'", [userId, monthAgo]);
    res.json({
      ok: true,
      usage: {
        light:  { today: Number(lightDay?.c || 0), month: Number(lightMon?.c || 0) },
        medium: { today: Number(medDay?.c || 0),   month: Number(medMon?.c || 0) },
        heavy:  { today: Number(heavyDay?.c || 0), month: Number(heavyMon?.c || 0) },
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Groups ─────────────────────────────────────────────────────────────────
router.get('/groups', async (req, res) => {
  try {
    const [wa, tg] = await Promise.all([
      authRepo.getAuthorizedGroups('wa'),
      authRepo.getAuthorizedGroups('tg'),
    ]);
    res.json({ ok: true, wa, tg });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/groups', async (req, res) => {
  try {
    const { group_id, channel = 'wa' } = req.body || {};
    if (!group_id) return res.status(400).json({ ok: false, message: 'group_id is required' });
    await authRepo.addAuthorizedGroup(group_id, channel);
    logger.info('adminRouter', 'Group added', { group_id, channel });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { channel = 'wa' } = req.query;
    await authRepo.removeAuthorizedGroup(id, channel);
    logger.info('adminRouter', 'Group removed', { id, channel });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Tracked Applications ───────────────────────────────────────────────────
router.get('/tracked', async (req, res) => {
  try {
    res.json({
      ok: true,
      sarathi: await trackingRepository.listByType('sarathi'),
      vahan:   await trackingRepository.listByType('vahan'),
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/tracked/refresh', async (req, res) => {
  try {
    refreshAllTrackedApplications().catch((err) => {
      logger.error('adminRouter', 'Refresh failed', { error: err.message });
    });
    res.json({ ok: true, message: 'Refresh triggered in background.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/tracked/sarathi/:appNo', async (req, res) => {
  try {
    const { appNo } = req.params;
    const all = await trackingRepository.listByType('sarathi');
    const toRemove = all.filter(e => e.appNo === appNo);
    let removed = false;
    for (const entry of toRemove) {
      const r = await trackingRepository.remove('sarathi', { appNo: entry.appNo, chatId: entry.chatId, transport: entry.transport });
      if (r.removed) removed = true;
    }
    logger.info('adminRouter', 'Sarathi track removed', { appNo, count: toRemove.length });
    res.json({ ok: true, removed, count: toRemove.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/tracked/vahan/:appNo', async (req, res) => {
  try {
    const { appNo } = req.params;
    const all = await trackingRepository.listByType('vahan');
    const toRemove = all.filter(e => (e.applicationNumber || e.appNo) === appNo);
    let removed = false;
    for (const entry of toRemove) {
      const r = await trackingRepository.remove('vahan', { transport: entry.transport, chatId: entry.chatId, applicationNumber: entry.applicationNumber || appNo });
      if (r && r.removed) removed = true;
    }
    logger.info('adminRouter', 'Vahan track removed', { appNo, count: toRemove.length });
    res.json({ ok: true, removed, count: toRemove.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Jobs ───────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const filters = {
      status:  req.query.status  || undefined,
      userId:  req.query.user_id || undefined,
      command: req.query.command || undefined,
      from:    req.query.from    || undefined,
      to:      req.query.to      || undefined,
      limit:   Number(req.query.limit) || 100,
      offset:  Number(req.query.offset) || 0,
    };
    const jobs = await jobRepository.queryJobs(filters);
    res.json({ ok: true, jobs });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/jobs/:jobId', async (req, res) => {
  try {
    const job = await jobRepository.getJobById(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, message: 'Job not found' });
    res.json({ ok: true, job });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const removedFromApi = await cancelQueueJob(apiQueue, jobId);
    const removedFromBrowser = await cancelQueueJob(browserQueue, jobId);
    const cancelled = await jobRepository.cancelJob(jobId);
    if (!cancelled && !removedFromApi && !removedFromBrowser) {
      return res.status(400).json({ ok: false, message: 'Job not found or not in pending state' });
    }
    logger.info('adminRouter', 'Job cancelled', { jobId });
    res.json({ ok: true, cancelled: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Queues ─────────────────────────────────────────────────────────────────
router.get('/queues', async (req, res) => {
  const [apiStats, browserStats] = await Promise.all([
    getQueueStats(apiQueue),
    getQueueStats(browserQueue)
  ]);
  res.json({
    ok: true,
    api:     apiStats,
    browser: browserStats,
  });
});

// ── Activity Log ──────────────────────────────────────────────────────────
router.get('/activity', async (req, res) => {
  try {
    const filters = {
      userId:   req.query.user_id  || undefined,
      category: req.query.category || undefined,
      from:     req.query.from     || undefined,
      to:       req.query.to       || undefined,
      limit:    Number(req.query.limit) || 200,
    };
    const activity = await authRepo.getActivityLog(filters);
    res.json({ ok: true, activity });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Stats Summary ─────────────────────────────────────────────────────────
router.get('/stats/summary', async (req, res) => {
  try {
    const jobStats = await authRepo.getJobStats();
    const totalCredits = await authRepo.getTotalCredits();
    const totalCreditsSpent = await authRepo.getTotalCreditsSpent();
    const users = await authRepo.getUsersWithSpentCredits();
    res.json({
      ok: true,
      ...jobStats,
      totalCredits,
      totalCreditsSpent,
      totalUsers: users.length,
      activeUsers: users.filter(u => Number(u.is_active) === 1).length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── System Health (Stateless container fallback) ──────────────────────────
router.get('/health', async (req, res) => {
  const [apiStats, browserStats] = await Promise.all([
    getQueueStats(apiQueue),
    getQueueStats(browserQueue)
  ]);
  res.json({
    ok: true,
    uptime:       Math.floor(process.uptime()),
    memory:       process.memoryUsage(),
    sessions:     [], // fallback for stateless API container
    browserPages: [],
    queues: {
      api:     apiStats,
      browser: browserStats,
    },
    config: {
      whatsappEnabled: CONFIG.WHATSAPP.ENABLED,
      telegramEnabled: CONFIG.TELEGRAM.ENABLED,
      aiParsingEnabled: CONFIG.AI_PARSING.ENABLED,
      dailyFillingEnabled: CONFIG.DAILY_FILLING.ENABLED,
      apiConcurrency: CONFIG.QUEUE.API_CONCURRENCY,
      browserConcurrency: CONFIG.QUEUE.BROWSER_CONCURRENCY,
      sessionPoolSize: CONFIG.SESSION_POOL_SIZE,
      maxBrowserPages: CONFIG.MAX_BROWSER_PAGES,
    },
  });
});

router.get('/wa/active', async (req, res) => {
  try {
    const [active, primary, failover] = await Promise.all([
      redis.get('wa:active'),
      redis.get('wa:heartbeat:primary'),
      redis.get('wa:heartbeat:failover'),
    ]);
    res.json({ ok: true, active, heartbeat: { primary: Boolean(primary), failover: Boolean(failover) } });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/wa/active', async (req, res) => {
  try {
    const { instanceId } = req.body || {};
    if (!instanceId) return res.status(400).json({ ok: false, message: 'instanceId is required' });
    await redis.set('wa:active', String(instanceId));
    await redis.publish('admin:broadcast', JSON.stringify({ event: 'wa_active_changed', instanceId, timestamp: Date.now() }));
    logger.warn('adminRouter', 'WhatsApp active instance changed', { instanceId });
    res.json({ ok: true, active: instanceId });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Database Backup (Placeholder for pg_dump trigger via BullMQ/Scheduler) ───
router.post('/backup', async (req, res) => {
  try {
    // In multi-service, manual database backup can be enqueued to apiQueue to be run by the worker
    const job = await apiQueue.add('db_backup_manual', {
      timestamp: Date.now()
    });
    logger.info('adminRouter', 'Manual backup enqueued', { jobId: job.id });
    res.json({ ok: true, message: 'Database backup triggered in background', jobId: job.id });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/backups', (req, res) => {
  // Returns empty list or we can read from shared data/backups directory if mounted
  const BACKUP_DIR = path.resolve(__dirname, '../../../../data/backups');
  let backups = [];
  try {
    if (fs.existsSync(BACKUP_DIR)) {
      backups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('pg_backup_') && f.endsWith('.dump'))
        .map(f => {
          const p = path.join(BACKUP_DIR, f);
          const stat = fs.statSync(p);
          return {
            fileName: f,
            path: p,
            sizeBytes: stat.size,
            createdAt: stat.mtime.toISOString(),
            type: 'manual',
            verified: true
          };
        });
    }
  } catch (_) {}
  res.json({ ok: true, backups });
});

router.get('/backups/health', (req, res) => {
  res.json({ ok: true, health: 'healthy', history: [] });
});

router.get('/backups/:fileName/download', (req, res) => {
  const fs = require('fs');
  const BACKUP_DIR = path.resolve(__dirname, '../../../../data/backups');
  const fileName = path.basename(req.params.fileName);
  if (!fileName.startsWith('pg_backup_') || !fileName.endsWith('.dump')) {
    return res.status(400).json({ ok: false, message: 'Invalid backup file name' });
  }
  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, message: 'Backup not found' });
  }
  res.download(filePath, fileName);
});

/** GET /admin/api/stats/credits — enhanced credit breakdown */
router.get('/stats/credits', async (req, res) => {
  try {
    const [totalCredits, totalCreditsSpent, users] = await Promise.all([
      authRepo.getTotalCredits(),
      authRepo.getTotalCreditsSpent(),
      authRepo.getUsersWithSpentCredits(),
    ]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayRow] = await db.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM credit_transactions WHERE action='deduct' AND created_at >= ?`,
      [todayStart.toISOString()]
    );
    const creditsSpentToday = Number(todayRow?.total || 0);

    const topSpenders = [...users]
      .sort((a, b) => Number(b.credits_spent || 0) - Number(a.credits_spent || 0))
      .slice(0, 5)
      .map(u => ({ phone: u.canonical_phone, name: u.name, credits_spent: Number(u.credits_spent || 0), credits: Number(u.credits || 0) }));

    res.json({
      ok: true,
      totalCredits,
      totalCreditsSpent,
      creditsSpentToday,
      totalUsers: users.length,
      topSpenders,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Payment Requests ────────────────────────────────────────────────────────
router.get('/payments/pending', async (req, res) => {
  try {
    const pending = await authRepo.getPendingPaymentRequests();
    res.json({ ok: true, pending });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.get('/payments', async (req, res) => {
  try {
    const payments = await authRepo.getAllPaymentRequests();
    res.json({ ok: true, payments });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/payments/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, note = '' } = req.body || {};
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ ok: false, message: 'Valid amount is required' });
    }

    const adminName = req.admin?.username || 'admin';
    const result = await authRepo.approvePaymentRequest(id, Number(amount), note, adminName);
    
    // Notify the user on WhatsApp about credit add!
    const chatNotifier = require('@sarathi/common').chatNotifier;
    try {
      const targetJid = `${result.userPhone}@c.us`;
      const notificationText = `💰 *क्रेडिट जोड़े गए (Credits Added!)* 💰\n\n` +
        `आपका पेमेंट (UTR: ${result.utr}) स्वीकृत कर लिया गया है।\n` +
        `• *जोड़े गए क्रेडिट (Added):* +${amount} credits\n` +
        `• *नया बैलेंस (New Balance):* ${result.after} credits\n\n` +
        `सरथी बॉट का उपयोग करने के लिए धन्यवाद! 🚀`;
      await chatNotifier.sendWhatsAppText(targetJid, notificationText);
    } catch (sendErr) {
      logger.error('adminRouter', `Failed to send WhatsApp topup approval notification to ${result.userPhone}`, { error: sendErr.message });
    }

    // Send Discord notification if configured
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
    if (webhookUrl) {
      try {
        const title = `🟢 Payment Request Approved`;
        const description = `**User:** ${result.userPhone}\n` +
          `**Amount Approved:** ₹${amount}\n` +
          `**UTR:** \`${result.utr}\`\n` +
          `**Approved By:** ${adminName}\n` +
          `**New Balance:** ${result.after} credits`;
        await chatNotifier.sendDiscordAlert(title, description, 'success');
      } catch (_) {}
    }

    logger.info('adminRouter', `Payment request ${id} approved`, { amount, adminName });
    res.json({ ok: true, message: 'Payment request approved and credits added.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/payments/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { note = '' } = req.body || {};
    const adminName = req.admin?.username || 'admin';
    
    // Fetch payment details to notify the user
    const [payReq] = await authRepo.query('SELECT p.*, u.canonical_phone FROM payment_requests p LEFT JOIN auth_users u ON p.user_id = u.id WHERE p.id = ?', [id]);
    if (!payReq) {
      return res.status(404).json({ ok: false, message: 'Payment request not found' });
    }

    await authRepo.rejectPaymentRequest(id, note, adminName);

    // Notify the user on WhatsApp about rejection
    if (payReq.canonical_phone) {
      const chatNotifier = require('@sarathi/common').chatNotifier;
      try {
        const targetJid = `${payReq.canonical_phone}@c.us`;
        const notificationText = `❌ *पेमेंट अस्वीकृत (Payment Rejected)* ❌\n\n` +
          `आपका पेमेंट (UTR: ${payReq.utr}) अस्वीकृत कर दिया गया है।\n` +
          `• *कारण (Reason):* ${note || 'अमान्य पेमेंट प्रूफ (Invalid payment proof)'}\n\n` +
          `यदि यह एक त्रुटि है, तो कृपया एडमिन से संपर्क करें।`;
        await chatNotifier.sendWhatsAppText(targetJid, notificationText);
      } catch (sendErr) {
        logger.error('adminRouter', `Failed to send WhatsApp rejection notification to ${payReq.canonical_phone}`, { error: sendErr.message });
      }
    }

    // Send Discord notification if configured
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
    if (webhookUrl) {
      const chatNotifier = require('@sarathi/common').chatNotifier;
      try {
        const title = `🔴 Payment Request Rejected`;
        const description = `**User:** ${payReq.canonical_phone || 'Unknown'}\n` +
          `**UTR:** \`${payReq.utr}\`\n` +
          `**Rejected By:** ${adminName}\n` +
          `**Reason:** ${note || 'Invalid payment proof'}`;
        await chatNotifier.sendDiscordAlert(title, description, 'danger');
      } catch (_) {}
    }

    logger.info('adminRouter', `Payment request ${id} rejected`, { adminName, note });
    res.json({ ok: true, message: 'Payment request rejected.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Keeping track of active SSE connections
let sseClients = [];

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.push(client);
  logger.info('adminRouter', `SSE client connected: ${client.id}. Total active: ${sseClients.length}`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== client.id);
    logger.info('adminRouter', `SSE client disconnected: ${client.id}. Total active: ${sseClients.length}`);
  });
});

// Setup subscriber for real-time broadcast to SSE clients
subscriber.on('message', (channel, message) => {
  if (channel === 'admin:broadcast') {
    sseClients.forEach(client => {
      try {
        client.res.write(`data: ${message}\n\n`);
      } catch (err) {
        logger.error('adminRouter', `Failed to write to SSE client ${client.id}: ${err.message}`);
      }
    });
  }
});
subscriber.subscribe('admin:broadcast').catch(err => {
  logger.error('adminRouter', `Failed to subscribe to Redis admin:broadcast: ${err.message}`);
});

module.exports = router;
