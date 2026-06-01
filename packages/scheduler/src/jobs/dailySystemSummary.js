const { authorizationRepository: authRepo, chatNotifier, logger } = require('@sarathi/common');

async function sendDailySystemSummary() {
  logger.info('scheduler', 'Generating and sending daily system summary to Discord...');
  try {
    const jobStats = await authRepo.getJobStats();
    const totalCredits = await authRepo.getTotalCredits();
    const users = await authRepo.getUsersWithSpentCredits();
    
    const activeUsersCount = users.filter(u => Number(u.is_active) === 1).length;
    
    // Get credits spent today
    const { query } = require('@sarathi/common').db;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayRow] = await query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM credit_transactions WHERE action='deduct' AND created_at >= ?`,
      [todayStart.toISOString()]
    );
    const creditsSpentToday = Number(todayRow?.total || 0);

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK;
    if (webhookUrl) {
      const title = `📊 Daily System Health & Summary`;
      const description = `• **Active Users:** ${activeUsersCount}\n` +
        `• **Jobs Today:** ${jobStats.todayCount}\n` +
        `• **Success Rate:** ${jobStats.successRate}%\n` +
        `• **System Total Credits:** ${totalCredits} credits\n` +
        `• **Credits Spent Today:** ${creditsSpentToday} credits`;
      
      await chatNotifier.sendDiscordAlert(title, description, 'info');
      logger.info('scheduler', 'Daily system summary sent to Discord successfully');
    } else {
      logger.warn('scheduler', 'Skipping daily system summary: DISCORD_WEBHOOK not set');
    }
  } catch (err) {
    logger.error('scheduler', `Failed to send daily system summary: ${err.stack}`);
  }
}

module.exports = {
  sendDailySystemSummary
};
