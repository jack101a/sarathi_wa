const CONFIG = require('../config/config');
const { query, run } = require('./db');

function planLimit(plan) { return CONFIG.RATE_LIMITS[plan] || CONFIG.RATE_LIMITS.free; }

async function checkRateLimit(userId, plan) {
  const limits = planLimit(plan || 'free');
  const now = Date.now();
  const minuteAgo = new Date(now - 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const [perMinute] = await query('SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id = ? AND timestamp >= ?', [userId, minuteAgo]);
  if ((perMinute && perMinute.c) >= limits.perMinute) return { allowed: false, reason: 'per-minute limit reached' };
  const [perDay] = await query('SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id = ? AND timestamp >= ?', [userId, dayAgo]);
  if ((perDay && perDay.c) >= limits.perDay) return { allowed: false, reason: 'per-day limit reached' };
  const [user] = await query('SELECT used_count, monthly_limit, subscription_plan FROM auth_users WHERE id = ?', [userId]);
  const monthLimit = Number((user && user.monthly_limit) || limits.perMonth || 0);
  if (Number((user && user.used_count) || 0) >= monthLimit) return { allowed: false, reason: 'monthly quota reached' };
  return { allowed: true, reason: '' };
}

async function recordRequest(userId, command) {
  await run('INSERT INTO rate_limit_log (user_id, timestamp, command) VALUES (?, ?, ?)', [userId, new Date().toISOString(), String(command || '')]);
  await run("DELETE FROM rate_limit_log WHERE timestamp < datetime('now', '-1 day')");
}

async function getActiveJobCount(userId) {
  const [row] = await query("SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND status IN ('pending','running')", [userId]);
  return Number((row && row.c) || 0);
}

module.exports = { checkRateLimit, recordRequest, getActiveJobCount };
