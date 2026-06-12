const { authorizationRepository: authRepo, chatNotifier, logger } = require('@sarathi/common');

function getFutureDateStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function checkAndDeactivateExpiredPlans() {
  logger.info('scheduler', 'Checking for expired subscription plans...');
  try {
    const nowStr = new Date().toISOString().slice(0, 10);
    const users = await authRepo.query(
      "SELECT id, canonical_phone, COALESCE(plan_id, 'free') AS subscription_plan, expiry_date FROM auth_users WHERE is_active = 1 AND expiry_date IS NOT NULL"
    );

    let deactivatedCount = 0;
    for (const u of users) {
      const expiryDate = new Date(u.expiry_date).toISOString().slice(0, 10);
      if (expiryDate < nowStr && u.subscription_plan !== 'free') {
        logger.info('scheduler', `Deactivating expired plan for user ${u.canonical_phone} (expired on ${u.expiry_date})`);
        
        // Downgrade to free tier
        await authRepo.updateUserProfile(u.canonical_phone, {
          plan_id: 'free',
          expiry_date: null
        });

        // Notify user
        const chatId = `${u.canonical_phone}@c.us`;
        const text = "❌ *Plan Expired*\nYour Premium plan has expired. You have been downgraded to the Free Tier.";
        await chatNotifier.sendWhatsAppText(chatId, text);
        
        deactivatedCount++;
      }
    }
    logger.info('scheduler', `Plan expiry check complete. Downgraded ${deactivatedCount} users.`);
  } catch (err) {
    logger.error('scheduler', `Failed checking expired plans: ${err.stack}`);
  }
}

async function sendExpiryWarnings() {
  logger.info('scheduler', 'Running daily plan expiry warnings job...');
  try {
    const date7 = getFutureDateStr(7);
    const date3 = getFutureDateStr(3);
    const date1 = getFutureDateStr(1);

    const users = await authRepo.query(
      "SELECT id, canonical_phone, COALESCE(plan_id, 'free') AS subscription_plan, expiry_date FROM auth_users WHERE is_active = 1 AND expiry_date IS NOT NULL"
    );

    let warningCount = 0;
    for (const u of users) {
      if (u.subscription_plan === 'free') continue;

      const expiry = new Date(u.expiry_date).toISOString().slice(0, 10);
      let text = '';
      if (expiry === date7) {
        text = `📅 *Plan Expiry Warning*\nYour subscription plan will expire in 7 days (on ${expiry}).`;
      } else if (expiry === date3) {
        text = `📅 *Plan Expiry Warning*\nYour subscription plan will expire in 3 days (on ${expiry}).`;
      } else if (expiry === date1) {
        text = `🚨 *Plan Expiry Warning*\nYour subscription plan expires tomorrow (on ${expiry}).`;
      }

      if (text) {
        const chatId = `${u.canonical_phone}@c.us`;
        logger.info('scheduler', `Sending plan expiry warning to ${u.canonical_phone} (expires ${expiry})`);
        await chatNotifier.sendWhatsAppText(chatId, text);
        warningCount++;
      }
    }
    logger.info('scheduler', `Plan expiry warnings job complete. Sent warnings to ${warningCount} users.`);
  } catch (err) {
    logger.error('scheduler', `Failed sending expiry warnings: ${err.stack}`);
  }
}

module.exports = {
  checkAndDeactivateExpiredPlans,
  sendExpiryWarnings
};
