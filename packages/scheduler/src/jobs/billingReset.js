const { authorizationRepository: authRepo, logger } = require('@sarathi/common');

async function resetDailyCounts() {
  logger.info('scheduler', 'Running daily usage reset job...');
  try {
    await authRepo.query(
      'UPDATE auth_users SET daily_count = 0, last_daily_reset = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE is_active = 1'
    );
    logger.info('scheduler', 'Successfully reset daily counts for all active users');
  } catch (err) {
    logger.error('scheduler', `Failed to reset daily counts: ${err.stack}`);
  }
}

async function resetExpiredMonthlyCounts() {
  logger.info('scheduler', 'Running monthly usage reset job...');
  try {
    const users = await authRepo.query("SELECT id, billing_cycle_start FROM auth_users WHERE is_active = 1 AND billing_cycle_start IS NOT NULL");
    const now = Date.now();
    let resetCount = 0;
    for (const u of users) {
      const start = new Date(u.billing_cycle_start).getTime();
      if (start && now - start >= 30 * 24 * 60 * 60 * 1000) {
        await authRepo.resetMonthlyUsage(u.id);
        resetCount++;
      }
    }
    logger.info('scheduler', `Successfully reset monthly counts for ${resetCount} users`);
  } catch (err) {
    logger.error('scheduler', `Failed to reset monthly counts: ${err.stack}`);
  }
}

module.exports = {
  resetDailyCounts,
  resetExpiredMonthlyCounts
};
