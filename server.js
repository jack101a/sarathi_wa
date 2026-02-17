/**
 * Application entrypoint responsibility:
 * Start the bot process and expose any optional HTTP surface.
 */

const CONFIG = require('./src/config/config');

async function startServer() {
  let waClient;

  try {
    const { createBot } = require('./src/bot');
    waClient = await createBot();
  } catch (error) {
    console.error('Failed to start bot.');
    console.error(error.message);

    if (process.env.APP_ENV !== 'production') {
      console.error(error.stack);
    }

    throw error;
  }

  try {
    const { startTelegramBot } = require('./src/telegramBot');
    await startTelegramBot(CONFIG);
  } catch (error) {
    console.error('Telegram bot failed to start. WhatsApp bot will continue running.');
    console.error(error.message);

    if (process.env.APP_ENV !== 'production') {
      console.error(error.stack);
    }
  }

  return waClient;
}

module.exports = {
  startServer,
};

startServer().catch(() => {
  process.exit(1);
});