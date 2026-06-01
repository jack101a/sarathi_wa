const { startApiWorker } = require('./processor');

async function main() {
  console.log('[Worker-API] Starting service...');
  const worker = startApiWorker();

  const handleShutdown = async (signal) => {
    console.log(`[Worker-API] Received ${signal}. Shutting down worker...`);
    await worker.close();
    process.exit(0);
  };

  process.once('SIGINT', () => handleShutdown('SIGINT'));
  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`[Worker-API] Fatal startup error: ${err.stack}`);
  process.exit(1);
});
