/**
 * Admin router responsibility:
 * All REST endpoints consumed by the admin dashboard frontend.
 * Mounted at /admin/api in server.js.
 */

const express = require('express');
const router = express.Router();
const { query: dbQuery } = require('../core/db');
const logger = require('../core/logger');
const CONFIG = require('../config/config');

const { handleLogin, handleLogout, handleVerify, requireAdminAuth } = require('./adminAuth');
const authService = require('../services/authorizationService');
const authRepo    = require('../services/authorizationRepository');
const { readTrackedApplications, removeTrackedApplication } = require('../services/autoTrackStore');
const { readEntries: readVahanStore, removeEntry: removeVahanEntry } = require('../services/vahanTrackStore');
const { refreshAllTrackedApplications } = require('../services/trackingControlService');
const jobRepository = require('../services/jobRepository');
const planRepository = require('../services/planRepository');
const { apiQueue, browserQueue } = require('../core/jobQueue');
const { getPoolStatus } = require('../core/sessionManager');
const { getPageStats } = require('../core/puppeteerEngine');

// ── Public routes (no auth required) ──────────────────────────────────────

router.post('/login',  handleLogin);
router.post('/logout', handleLogout);

/** Verify current session — returns 401 if not authenticated */
router.get('/verify', requireAdminAuth, handleVerify);

// ─── Protected routes ───────────────────────────────────────────────────────

router.use(requireAdminAuth);

// ── Bootstrap (single call that loads everything the dashboard needs) ──────
router.get('/bootstrap', async (req, res) => {
  try {
    const [users, waGroups, tgGroups] = await Promise.all([
      authRepo.listAllUsers(),
      authRepo.getAuthorizedGroups('wa'),
      authRepo.getAuthorizedGroups('tg'),
    ]);

    const sarathi = readTrackedApplications();
    const vahan   = readVahanStore();
    const jobs    = await jobRepository.getPendingJobs('api', 20);
    const jobStats = await authRepo.getJobStats();
    const totalCredits = await authRepo.getTotalCredits();

    res.json({
      ok: true,
      stats: {
        totalUsers:    users.length,
        activeUsers:   users.filter(u => Number(u.is_active) === 1).length,
        sarathiTracked: sarathi.length,
        vahanTracked:  vahan.length,
        pendingJobs:   apiQueue.getStats().pending + browserQueue.getStats().pending,
        uptime:        Math.floor(process.uptime()),
        memory:        process.memoryUsage(),
        totalCredits,
        jobsToday:     jobStats.todayCount,
        successRate:   jobStats.successRate,
      },
      users,
      waGroups,
      tgGroups,
      sarathiTracked: sarathi,
      vahanTracked:   vahan,
      recentJobs:     jobs,
      queues: {
        api:     apiQueue.getStats(),
        browser: browserQueue.getStats(),
      },
      rateLimitConfig: {
        plans: CONFIG.RATE_LIMITS,
        creditCost: CONFIG.CREDIT_COST,
      },
    });
  } catch (err) {
    logger.error('adminRouter', 'Bootstrap failed', { error: err.message });
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

// ── Users ──────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const users = await authRepo.listAllUsers();
    res.json({ ok: true, users });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { phone, channel = 'wa', name = '', plan = 'standard', monthly_limit = 0, expiry_date = '' } = req.body || {};
    if (!phone) return res.status(400).json({ ok: false, message: 'phone is required' });
    
    // Step 1: Create/Add the authorized entry
    const user = await authService.addAuthorizedEntry(channel, 'user', phone, { name, plan, monthly_limit, expiry_date });
    logger.info('adminRouter', 'User created', { phone, channel });

    let verificationCode = null;

    // Step 2: For WhatsApp channel, trigger outbound activation code message
    if (channel === 'wa' || channel === 'whatsapp') {
      const waVerificationService = require('../services/waVerificationService');
      const chatNotifier = require('../services/chatNotifier');
      
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
    const waVerificationService = require('../services/waVerificationService');
    const chatNotifier = require('../services/chatNotifier');
    
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
    if (!action || !['add', 'set'].includes(action)) return res.status(400).json({ ok: false, message: "action must be 'add' or 'set'" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ ok: false, message: 'amount must be positive' });
    const user = await authRepo.getUserByPhone(phone);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    let result;
    if (action === 'add') result = await authRepo.addCreditsAudited(user.id, Number(amount), note, 'admin');
    else                  result = await authRepo.setCreditsAudited(user.id, Number(amount), note, 'admin');
    logger.info('adminRouter', `Credits ${action}`, { phone, amount, newBalance: result.newBalance });
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
    const [lightDay]  = await dbQuery("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light'", [userId, dayAgo]);
    const [medDay]    = await dbQuery("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium'", [userId, dayAgo]);
    const [heavyDay]  = await dbQuery("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='heavy'", [userId, dayAgo]);
    const [lightMon]  = await dbQuery("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light'", [userId, monthAgo]);
    const [medMon]    = await dbQuery("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium'", [userId, monthAgo]);
    const [heavyMon]  = await dbQuery("SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='heavy'", [userId, monthAgo]);
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
router.get('/tracked', (req, res) => {
  try {
    res.json({
      ok: true,
      sarathi: readTrackedApplications(),
      vahan:   readVahanStore(),
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

router.delete('/tracked/sarathi/:appNo', (req, res) => {
  try {
    const { appNo } = req.params;
    const all = readTrackedApplications();
    const toRemove = all.filter(e => e.appNo === appNo);
    let removed = false;
    for (const entry of toRemove) {
      const r = removeTrackedApplication({ appNo: entry.appNo, chatId: entry.chatId, transport: entry.transport });
      if (r.removed) removed = true;
    }
    logger.info('adminRouter', 'Sarathi track removed', { appNo, count: toRemove.length });
    res.json({ ok: true, removed, count: toRemove.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.delete('/tracked/vahan/:appNo', (req, res) => {
  try {
    const { appNo } = req.params;
    const all = readVahanStore();
    const toRemove = all.filter(e => (e.applicationNumber || e.appNo) === appNo);
    let removed = false;
    for (const entry of toRemove) {
      const r = removeVahanEntry({ transport: entry.transport, chatId: entry.chatId, applicationNumber: entry.applicationNumber || appNo });
      if (r && r.removed) removed = true;
    }
    logger.info('adminRouter', 'Vahan track removed', { appNo, count: toRemove.length });
    res.json({ ok: true, removed, count: toRemove.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Jobs (enhanced with filtering + detail + cancel) ──────────────────────
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
    // Try to remove from in-memory queue first
    const removedFromApi = apiQueue.cancelPendingJob(jobId);
    const removedFromBrowser = browserQueue.cancelPendingJob(jobId);
    // Update DB status
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
router.get('/queues', (req, res) => {
  res.json({
    ok: true,
    api:     apiQueue.getStats(),
    browser: browserQueue.getStats(),
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
    const users = await authRepo.listAllUsers();
    res.json({
      ok: true,
      ...jobStats,
      totalCredits,
      totalUsers: users.length,
      activeUsers: users.filter(u => Number(u.is_active) === 1).length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── System Health ──────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime:       Math.floor(process.uptime()),
    memory:       process.memoryUsage(),
    sessions:     getPoolStatus(),
    browserPages: getPageStats(),
    queues: {
      api:     apiQueue.getStats(),
      browser: browserQueue.getStats(),
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

module.exports = router;

