const cron = require('node-cron');
const { query } = require('../core/db');
const authRepo = require('./authorizationRepository');
const jobRepository = require('./jobRepository');

async function resetAllDailyCountsJob() {
  const users = await query('SELECT id FROM auth_users WHERE is_active = 1');
  for (const u of users) await authRepo.resetDailyCount(u.id);
}

async function resetExpiredMonthlyCountsJob() {
  const users = await query("SELECT id, billing_cycle_start FROM auth_users WHERE is_active = 1 AND billing_cycle_start != ''");
  const now = Date.now();
  for (const u of users) {
    const start = new Date(u.billing_cycle_start).getTime();
    if (start && now - start >= 30 * 24 * 60 * 60 * 1000) await authRepo.resetMonthlyUsage(u.id);
  }
}

function startBillingCron() {
  cron.schedule('0 0 * * *', () => resetAllDailyCountsJob().catch(() => {}));
  cron.schedule('0 * * * *', () => resetExpiredMonthlyCountsJob().catch(() => {}));
  cron.schedule('0 2 * * 0', () => jobRepository.cleanupOldJobs(30).catch(() => {}));
}

module.exports = { startBillingCron };
