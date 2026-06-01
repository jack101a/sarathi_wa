const { createWhatsAppClient } = require('./client');
const { handleIncomingMessage } = require('./messageHandler');
const { startResponseListener } = require('./responseDelivery');
const { startHeartbeat, stopHeartbeat, INSTANCE_ID, INSTANCE_ROLE } = require('./heartbeat');

async function main() {
  console.log(`[Gateway] Starting WhatsApp Gateway: ID=${INSTANCE_ID}, ROLE=${INSTANCE_ROLE}`);

  // Start heartbeat failover logic
  await startHeartbeat();

  // Create WhatsApp client
  const client = await createWhatsAppClient(handleIncomingMessage);

  // Start Redis Pub/Sub response listener
  await startResponseListener(client);

  // Register signal handlers for graceful shutdown
  const handleShutdown = async (signal) => {
    console.log(`[Gateway] Received ${signal}. Shutting down...`);
    stopHeartbeat();
    if (client && typeof client.destroy === 'function') {
      await client.destroy().catch(() => {});
    }
    process.exit(0);
  };

  process.once('SIGINT', () => handleShutdown('SIGINT'));
  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`[Gateway] Fatal startup error: ${err.stack}`);
  process.exit(1);
});
