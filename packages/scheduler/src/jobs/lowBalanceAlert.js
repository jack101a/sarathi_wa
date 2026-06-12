const { authorizationRepository: authRepo, chatNotifier, logger } = require('@sarathi/common');

async function sendLowBalanceAlerts() {
  logger.info('scheduler', 'Running daily low balance alerts job...');
  try {
    const users = await authRepo.query(
      "SELECT id, canonical_phone, credits, COALESCE(plan_id, 'free') AS subscription_plan FROM auth_users WHERE is_active = 1 AND COALESCE(plan_id, 'free') != 'free' AND credits < 50"
    );

    let alertCount = 0;
    for (const u of users) {
      const chatId = `${u.canonical_phone}@c.us`;
      const text = `⚠️ *Low Balance Alert*\nYou have only *${u.credits}* credits remaining.`;
      logger.info('scheduler', `Sending low balance warning to ${u.canonical_phone} (${u.credits} credits)`);
      await chatNotifier.sendWhatsAppText(chatId, text);
      alertCount++;
    }
    logger.info('scheduler', `Low balance alerts job complete. Sent warnings to ${alertCount} users.`);
  } catch (err) {
    logger.error('scheduler', `Failed sending low balance alerts: ${err.stack}`);
  }
}

module.exports = {
  sendLowBalanceAlerts
};
