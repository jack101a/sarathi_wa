/**
 * Application entrypoint responsibility:
 * Start the bot process, mount the admin HTTP server, and expose health endpoint.
 */

const path = require('path');
const CONFIG = require('./src/config/config');
const logger = require('./src/core/logger');
const { cleanupWhatsAppAuthLocks } = require('./src/core/runtimeCleanup');
const { closeBrowser } = require('./src/core/puppeteerEngine');
const { startWorkers, stopWorkers } = require('./src/workers');
const { startBillingCron } = require('./src/services/billingCron');

let shutdownInFlight = false;

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
    const deletedLocks = cleanupWhatsAppAuthLocks();
    if (deletedLocks.length > 0) logger.info('server', `Deleted ${deletedLocks.length} WhatsApp auth lock file(s).`);
    try {
      const { createBot } = require('./src/bot');
      waClient = await createBot();
    } catch (error) {
      logger.error('server', 'Failed to start WhatsApp bot', { error: error.message });
      throw error;
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
