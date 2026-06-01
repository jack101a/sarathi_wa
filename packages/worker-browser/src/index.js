const { startBrowserWorker } = require('./processor');

async function main() {
  console.log('[Worker-Browser] Starting service...');
  const worker = startBrowserWorker();

  const handleShutdown = async (signal) => {
    console.log(`[Worker-Browser] Received ${signal}. Shutting down worker...`);
    await worker.close();
    process.exit(0);
  };

  process.once('SIGINT', () => handleShutdown('SIGINT'));
  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`[Worker-Browser] Fatal startup error: ${err.stack}`);
  process.exit(1);
});
