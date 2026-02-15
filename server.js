/**
 * Application entrypoint responsibility:
 * Start the bot process and expose any optional HTTP surface.
 */

async function startServer() {
  try {
    const { createBot } = require('./src/bot');
    await createBot();
  } catch (error) {
    console.error('Failed to start bot.');
    console.error(error.message);

    if (process.env.APP_ENV !== 'production') {
      console.error(error.stack);
    }

    throw error;
  }
}

module.exports = {
  startServer,
};

startServer().catch(() => {
  process.exit(1);
});
