const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const authRepo = require('./authorizationRepository');
const jobRepository = require('./jobRepository');
const { cleanupRateLimitLog } = require('../core/rateLimiter');
const logger = require('../core/logger');
const { createBackup } = require('../core/dbBackup');

const TEMP_DIR = path.resolve(__dirname, '../../data/tmp');
const ROOT_DIR = path.resolve(__dirname, '../..');
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

async function resetAllDailyCountsJob() {
  const users = await authRepo.query('SELECT id FROM auth_users WHERE is_active = 1');
  for (const u of users) await authRepo.resetDailyCount(u.id);
}

async function resetExpiredMonthlyCountsJob() {
  const users = await authRepo.query("SELECT id, billing_cycle_start FROM auth_users WHERE is_active = 1 AND billing_cycle_start != ''");
  const now = Date.now();
  for (const u of users) {
    const start = new Date(u.billing_cycle_start).getTime();
    if (start && now - start >= 30 * 24 * 60 * 60 * 1000) await authRepo.resetMonthlyUsage(u.id);
  }
}

/** Remove temp files older than TEMP_FILE_MAX_AGE_MS from data/tmp and project root. */
function cleanupTempFiles() {
  const cutoff = Date.now() - TEMP_FILE_MAX_AGE_MS;

  // Clean data/tmp/
  if (fs.existsSync(TEMP_DIR)) {
    try {
      for (const file of fs.readdirSync(TEMP_DIR)) {
        const filePath = path.join(TEMP_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            logger.debug('billingCron', `Deleted temp file: ${file}`);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Clean scattered status_*.png and temp_table_*.html from project root
  try {
    for (const file of fs.readdirSync(ROOT_DIR)) {
      if (!/^(status_.*\.png|temp_table_.*\.html)$/.test(file)) continue;
      const filePath = path.join(ROOT_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          logger.debug('billingCron', `Deleted stale root temp file: ${file}`);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

function startBillingCron() {
  const cronOptions = { scheduled: true, timezone: 'Asia/Kolkata' };

  // Reset daily usage counts at midnight
  cron.schedule('0 0 * * *', () => resetAllDailyCountsJob().catch(() => {}), cronOptions);

  // Reset monthly usage when billing cycle ends
  cron.schedule('0 * * * *', () => resetExpiredMonthlyCountsJob().catch(() => {}), cronOptions);

  // Cleanup completed/failed jobs older than 30 days (weekly on Sunday 2am)
  cron.schedule('0 2 * * 0', () => jobRepository.cleanupOldJobs(30).catch(() => {}), cronOptions);

  // Cleanup rate limit log (hourly — moved from per-request to here)
  cron.schedule('15 * * * *', () => cleanupRateLimitLog().catch(() => {}), cronOptions);

  // Cleanup temp files (every hour)
  cron.schedule('30 * * * *', () => {
    try { cleanupTempFiles(); } catch (_) {}
  }, cronOptions);

  // Database backup every 6 hours
  cron.schedule('0 */6 * * *', () => {
    createBackup('scheduled').catch((err) => {
      logger.error('billingCron', 'Scheduled backup failed', { error: err.message });
    });
  }, cronOptions);

  logger.info('billingCron', 'Billing & cleanup crons started');
}

module.exports = { startBillingCron };
