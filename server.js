/**
 * Application entrypoint responsibility:
 * Start the bot process and expose any optional HTTP surface.
 */

const CONFIG = require('./src/config/config');
const { cleanupWhatsAppAuthLocks } = require('./src/core/runtimeCleanup');
const { closeBrowser } = require('./src/core/puppeteerEngine');

let shutdownInFlight = false;

async function shutdownService(name, action) {
  try {
    await action();
  } catch (error) {
    console.error(`${name} shutdown failed.`);
    console.error(error.message);

    if (process.env.APP_ENV !== 'production') {
      console.error(error.stack);
    }
  }
}

function registerSignalHandlers({ waClient, telegramBot }) {
  async function handleShutdown(signal) {
    if (shutdownInFlight) {
      return;
    }

    shutdownInFlight = true;
    console.log(`[shutdown] Received ${signal}. Closing services...`);

    await shutdownService('WhatsApp client', async () => {
      if (waClient && typeof waClient.destroy === 'function') {
        await waClient.destroy();
      }
    });

    await shutdownService('Telegram bot', async () => {
      if (telegramBot && typeof telegramBot.stopPolling === 'function') {
        await telegramBot.stopPolling({ cancel: true });
      }
    });

    await shutdownService('Puppeteer browser', async () => {
      await closeBrowser();
    });

    process.exit(0);
  }

  process.once('SIGINT', () => {
    handleShutdown('SIGINT').catch(() => {
      process.exit(1);
    });
  });

  process.once('SIGTERM', () => {
    handleShutdown('SIGTERM').catch(() => {
      process.exit(1);
    });
  });
}

async function startServer() {
  let waClient;
  let telegramBot;

  if (CONFIG.WHATSAPP.ENABLED) {
    const deletedLocks = cleanupWhatsAppAuthLocks();
    if (deletedLocks.length > 0) {
      console.log(`[startup] Deleted ${deletedLocks.length} WhatsApp auth lock file(s).`);
    }

    try {
      const { createBot } = require('./src/bot');
      waClient = await createBot();
    } catch (error) {
      console.error('Failed to start WhatsApp bot.');
      console.error(error.message);

      if (process.env.APP_ENV !== 'production') {
        console.error(error.stack);
      }

      throw error;
    }
  } else {
    console.log('WhatsApp bot is disabled. Set WHATSAPP_PHONE_NUMBER to enable it.');
  }

  if (CONFIG.TELEGRAM.ENABLED) {
    try {
      const { startTelegramBot } = require('./src/telegramBot');
      telegramBot = await startTelegramBot(CONFIG);
    } catch (error) {
      console.error('Telegram bot failed to start. Other services will continue running.');
      console.error(error.message);

      if (process.env.APP_ENV !== 'production') {
        console.error(error.stack);
      }
    }
  } else {
    console.log('Telegram bot is disabled. Set TELEGRAM_BOT_TOKEN to enable it.');
  }

  try {
    const { startAutoTrackScheduler } = require('./src/services/autoTrackService');
    const { startDailyNotificationScheduler } = require('./src/services/dailyNotificationService');
    startAutoTrackScheduler();
    startDailyNotificationScheduler();
  } catch (error) {
    console.error('Schedulers failed to start.');
    console.error(error.message);

    if (process.env.APP_ENV !== 'production') {
      console.error(error.stack);
    }
  }

  registerSignalHandlers({ waClient, telegramBot });

  return waClient;
}

module.exports = {
  startServer,
};

startServer().catch(() => {
  process.exit(1);
});
