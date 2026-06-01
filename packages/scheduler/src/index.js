const cron = require('node-cron');
const { redis, logger } = require('@sarathi/common');

const { resetDailyCounts, resetExpiredMonthlyCounts } = require('./jobs/billingReset');
const { checkAndDeactivateExpiredPlans, sendExpiryWarnings } = require('./jobs/expiryCheck');
const { sendLowBalanceAlerts } = require('./jobs/lowBalanceAlert');
const { runCleanup } = require('./jobs/cleanup');
const { runBackup } = require('./jobs/backup');
const { runAutoTrackSarathi, runAutoTrackVahan, sendDailyStatusReports } = require('./jobs/autoTrack');
const { sendDailySystemSummary } = require('./jobs/dailySystemSummary');

const cronOptions = {
  scheduled: true,
  timezone: 'Asia/Kolkata'
};

async function withLock(jobName, ttlSeconds, jobFn) {
  const lockKey = `lock:scheduler:${jobName}`;
  try {
    const acquired = await redis.set(lockKey, '1', 'NX', 'EX', ttlSeconds);
    if (acquired === 'OK') {
      logger.info('scheduler', `Acquired lock for scheduled job: ${jobName}`);
      await jobFn();
    } else {
      logger.debug('scheduler', `Skipping job: ${jobName} (lock already held by another instance)`);
    }
  } catch (err) {
    logger.error('scheduler', `Lock error during job ${jobName}: ${err.stack}`);
  }
}

function startScheduler() {
  console.log('[Scheduler] Initializing cron schedules (Asia/Kolkata)...');

  // 1. Reset daily usage counts at midnight & send daily summary
  cron.schedule('0 0 * * *', () => {
    withLock('daily_reset', 50, async () => {
      try {
        await sendDailySystemSummary();
      } catch (err) {
        logger.error('scheduler', `Failed running daily system summary: ${err.message}`);
      }
      await resetDailyCounts();
    });
  }, cronOptions);

  // 2. Reset monthly usage when 30-day billing cycle ends
  cron.schedule('0 * * * *', () => {
    withLock('monthly_reset', 50, resetExpiredMonthlyCounts);
  }, cronOptions);

  // 3. Check and deactivate expired plans every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    withLock('expiry_deactivation', 50, checkAndDeactivateExpiredPlans);
  }, cronOptions);

  // 4. Send expiry warnings (7d, 3d, 1d) daily at 9:00 AM
  cron.schedule('0 9 * * *', () => {
    withLock('expiry_warnings', 50, sendExpiryWarnings);
  }, cronOptions);

  // 5. Send low balance warnings daily at 8:00 AM
  cron.schedule('0 8 * * *', () => {
    withLock('low_balance_alerts', 50, sendLowBalanceAlerts);
  }, cronOptions);

  // 6. Cleanup completed/failed jobs weekly on Sunday at 2:00 AM
  cron.schedule('0 2 * * 0', () => {
    withLock('cleanup', 50, runCleanup);
  }, cronOptions);

  // 7. PostgreSQL backup every 6 hours
  cron.schedule('0 */6 * * *', () => {
    withLock('db_backup', 50, runBackup);
  }, cronOptions);

  // 8. Auto-track Sarathi applications every 30 minutes (staggered at minute 0 and 30)
  cron.schedule('0,30 * * * *', () => {
    withLock('auto_track_sarathi', 50, runAutoTrackSarathi);
  }, cronOptions);

  // 9. Auto-track Vahan applications every 30 minutes (staggered at minute 15 and 45)
  cron.schedule('15,45 * * * *', () => {
    withLock('auto_track_vahan', 50, runAutoTrackVahan);
  }, cronOptions);

  // 10. Send daily status reports report at 8:00 PM
  cron.schedule('0 20 * * *', () => {
    withLock('daily_reports', 50, sendDailyStatusReports);
  }, cronOptions);

  logger.info('scheduler', 'Scheduler cron runner service started successfully');
}

startScheduler();

const handleShutdown = async (signal) => {
  console.log(`[Scheduler] Received ${signal}. Shutting down scheduler...`);
  process.exit(0);
};

process.once('SIGINT', () => handleShutdown('SIGINT'));
process.once('SIGTERM', () => handleShutdown('SIGTERM'));
