/**
 * Application entrypoint responsibility:
 * Start the bot process, mount the admin HTTP server, and expose health endpoint.
 */

const path = require('path');
const CONFIG = require('./src/config/config');
const logger = require('./src/core/logger');
const {
  cleanupWhatsAppAuthLocks,
  cleanupWhatsAppRuntimeCache,
  releaseStaleWhatsAppProfileLocks,
} = require('./src/core/runtimeCleanup');
const { closeBrowser } = require('./src/core/puppeteerEngine');
const { startWorkers, stopWorkers } = require('./src/workers');
const { startBillingCron } = require('./src/services/billingCron');
const { close: closeDb, checkpoint: checkpointDb } = require('./src/core/db');
const { createBackup } = require('./src/core/dbBackup');

let shutdownInFlight = false;
const WA_START_MAX_ATTEMPTS = 3;

function isRetryableWhatsAppStartupError(error) {
  const text = String(error && error.message || '').toLowerCase();
  return (
    text.includes('execution context was destroyed') ||
    text.includes('target closed') ||
    text.includes('session closed') ||
    text.includes('protocol error') ||
    text.includes('timed out') ||
    text.includes('navigation') ||
    text.includes('browser is already running for')
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdownService(name, action) {
  try { await action(); } catch (error) {
    logger.error('server', `${name} shutdown failed`, { error: error.message });
  }
}

function registerSignalHandlers({ waClient, telegramBot }) {
  async function handleShutdown(signal) {
    if (shutdownInFlight) return;
    shutdownInFlight = true;
    logger.info('server', `Received ${signal} — shutting down`);

    await shutdownService('WhatsApp client', async () => { if (waClient && typeof waClient.destroy === 'function') await waClient.destroy(); });
    await shutdownService('Telegram bot',    async () => { if (telegramBot && typeof telegramBot.stopPolling === 'function') await telegramBot.stopPolling({ cancel: true }); });
    await shutdownService('Workers',         stopWorkers);
    await shutdownService('Puppeteer',       closeBrowser);
    await shutdownService('DB backup',       async () => { await createBackup(); });
    await shutdownService('DB checkpoint',   checkpointDb);
    await shutdownService('DB close',        closeDb);
    process.exit(0);
  }

  process.once('SIGINT',  () => { handleShutdown('SIGINT').catch(()  => process.exit(1)); });
  process.once('SIGTERM', () => { handleShutdown('SIGTERM').catch(() => process.exit(1)); });
}

// ─── Admin HTTP Server ───────────────────────────────────────────────────────
function startAdminServer() {
  const express      = require('express');
  const cookieParser = require('cookie-parser');

  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  // Admin REST API
  const adminRouter = require('./src/api/adminRouter');
  app.use('/admin/api', adminRouter);

  // Public health endpoint (no auth)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
    });
  });

  // Serve built React SPA for admin dashboard
  const frontendDist = path.join(__dirname, 'frontend', 'dist');
  const fs = require('fs');
  if (fs.existsSync(frontendDist)) {
    app.use('/admin', express.static(frontendDist));
    app.get('/admin/*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
    logger.info('server', 'Admin frontend served from frontend/dist');
  } else {
    app.get('/admin*', (_req, res) => res.status(503).send('Admin frontend not built. Run: cd frontend && npm run build'));
    logger.warn('server', 'Admin frontend dist not found — serving placeholder');
  }

  // Admin login page (served from same SPA)
  const port = CONFIG.PORT;
  app.listen(port, () => {
    logger.info('server', `HTTP server listening on port ${port}`, {
      adminUrl: `http://localhost:${port}/admin`,
      healthUrl: `http://localhost:${port}/health`,
    });
  });

  return app;
}

async function startServer() {
  let waClient;
  let telegramBot;

  // Start HTTP server first so /health is available during bot init
  startAdminServer();

  if (CONFIG.WHATSAPP.ENABLED) {
    const { createBot } = require('./src/bot');
    for (let attempt = 1; attempt <= WA_START_MAX_ATTEMPTS; attempt += 1) {
      const releaseResult = releaseStaleWhatsAppProfileLocks();
      if (releaseResult.attempted && releaseResult.killed > 0) {
        logger.info('server', `Stopped ${releaseResult.killed} stale Chromium profile process(es).`);
      }

      const lockCleanup = cleanupWhatsAppAuthLocks();
      const cacheCleanup = cleanupWhatsAppRuntimeCache();
      if (lockCleanup.deleted.length > 0 || lockCleanup.busyCount > 0) {
        logger.info(
          'server',
          `WhatsApp auth lock cleanup: deleted=${lockCleanup.deleted.length}, busy=${lockCleanup.busyCount}`
        );
      }
      if (cacheCleanup.deleted.length > 0 || cacheCleanup.busyCount > 0) {
        logger.info(
          'server',
          `WhatsApp runtime cache cleanup: deleted=${cacheCleanup.deleted.length}, busy=${cacheCleanup.busyCount}`
        );
      }

      try {
        waClient = await createBot();
        break;
      } catch (error) {
        logger.error('server', 'Failed to start WhatsApp bot', { error: error.message, attempt });
        if (attempt >= WA_START_MAX_ATTEMPTS || !isRetryableWhatsAppStartupError(error)) {
          throw error;
        }
        await wait(attempt * 2000);
      }
    }
  } else {
    logger.info('server', 'WhatsApp bot disabled (WHATSAPP_PHONE_NUMBER not set)');
  }

  if (CONFIG.TELEGRAM.ENABLED) {
    try {
      const { startTelegramBot } = require('./src/telegramBot');
      telegramBot = await startTelegramBot(CONFIG);
    } catch (error) {
      logger.error('server', 'Telegram bot failed to start — other services continue', { error: error.message });
    }
  } else {
    logger.info('server', 'Telegram bot disabled (TELEGRAM_BOT_TOKEN not set)');
  }

  try {
    const { startAutoTrackScheduler }      = require('./src/services/autoTrackService');
    const { startDailyNotificationScheduler } = require('./src/services/dailyNotificationService');
    startAutoTrackScheduler();
    startDailyNotificationScheduler();
    await startWorkers();
    startBillingCron();

    // Create a startup backup
    try {
      await createBackup();
      logger.info('server', 'Startup database backup created');
    } catch (err) {
      logger.warn('server', 'Startup backup failed (non-fatal)', { error: err.message });
    }

    logger.info('server', 'All services started');
  } catch (error) {
    logger.error('server', 'Schedulers/Workers failed to start', { error: error.message });
  }

  registerSignalHandlers({ waClient, telegramBot });
  return waClient;
}

module.exports = { startServer };

startServer().catch((err) => {
  logger.error('server', 'Fatal startup error', { error: err.message });
  process.exit(1);
});
