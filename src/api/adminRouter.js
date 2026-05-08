/**
 * Admin router responsibility:
 * All REST endpoints consumed by the admin dashboard frontend.
 * Mounted at /admin/api in server.js.
 */

const express = require('express');
const router = express.Router();
const { query: dbQuery } = require('../core/db');
const logger = require('../core/logger');

const { handleLogin, handleLogout, handleVerify, requireAdminAuth } = require('./adminAuth');
const authService = require('../services/authorizationService');
const authRepo    = require('../services/authorizationRepository');
const { readTrackedApplications, removeTrackedApplication } = require('../services/autoTrackStore');
const { readEntries: readVahanStore, removeEntry: removeVahanEntry } = require('../services/vahanTrackStore');
const { refreshAllTrackedApplications } = require('../services/trackingControlService');
const jobRepository = require('../services/jobRepository');
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
    });
  } catch (err) {
    logger.error('adminRouter', 'Bootstrap failed', { error: err.message });
    res.status(500).json({ ok: false, message: err.message });
  }
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
    const { phone, channel = 'wa', name = '', plan = 'free', monthly_limit = 50, expiry_date = '' } = req.body || {};
    if (!phone) return res.status(400).json({ ok: false, message: 'phone is required' });
    const user = await authService.addAuthorizedEntry(channel, 'user', phone, { name, plan, monthly_limit, expiry_date });
    logger.info('adminRouter', 'User created', { phone, channel });
    res.json({ ok: true, user });
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
    // Admin context: remove ALL tracking entries for this appNo across every chatId
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

// ── Jobs ───────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const jobs = await dbQuery(
      'SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', [limit]
    );
    res.json({ ok: true, jobs });
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
  });
});

module.exports = router;
