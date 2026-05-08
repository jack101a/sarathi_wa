const CONFIG = require('../config/config');
const { query, run } = require('./db');

// In-memory cache for per-minute and per-day counts
// Map<userId, { perMinute: number, perDay: number, lastUpdated: number }>
const _cache = new Map();
const CACHE_TTL_MS = 10_000; // 10 seconds

function planLimit(plan) { return CONFIG.RATE_LIMITS[plan] || CONFIG.RATE_LIMITS.free; }

async function _loadCounts(userId) {
  const now = Date.now();
  const minuteAgo = new Date(now - 60 * 1000).toISOString();
  const dayAgo    = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const [perMinuteRow] = await query('SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id = ? AND timestamp >= ?', [userId, minuteAgo]);
  const [perDayRow]    = await query('SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id = ? AND timestamp >= ?', [userId, dayAgo]);
  return {
    perMinute: Number((perMinuteRow && perMinuteRow.c) || 0),
    perDay:    Number((perDayRow    && perDayRow.c)    || 0),
    lastUpdated: Date.now(),
  };
}

async function checkRateLimit(userId, plan) {
  const limits = planLimit(plan || 'free');

  // Use cache if fresh
  const cached = _cache.get(userId);
  let counts;
  if (cached && Date.now() - cached.lastUpdated < CACHE_TTL_MS) {
    counts = cached;
  } else {
    counts = await _loadCounts(userId);
    _cache.set(userId, counts);
  }

  if (counts.perMinute >= limits.perMinute) return { allowed: false, reason: 'per-minute limit reached' };
  if (counts.perDay    >= limits.perDay)    return { allowed: false, reason: 'per-day limit reached' };

  // Monthly limit still checked directly (less frequent)
  const [user] = await query('SELECT used_count, monthly_limit, subscription_plan FROM auth_users WHERE id = ?', [userId]);
  const monthLimit = Number((user && user.monthly_limit) || limits.perMonth || 0);
  if (Number((user && user.used_count) || 0) >= monthLimit) return { allowed: false, reason: 'monthly quota reached' };

  return { allowed: true, reason: '' };
}

async function recordRequest(userId, command) {
  await run('INSERT INTO rate_limit_log (user_id, timestamp, command) VALUES (?, ?, ?)',
    [userId, new Date().toISOString(), String(command || '')]);

  // Invalidate cache for this user so next check is fresh
  _cache.delete(userId);
}

async function getActiveJobCount(userId) {
  const [row] = await query("SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND status IN ('pending','running')", [userId]);
  return Number((row && row.c) || 0);
}

/** Called by billingCron — cleanup old log rows instead of per-request */
async function cleanupRateLimitLog() {
  await run("DELETE FROM rate_limit_log WHERE timestamp < datetime('now', '-1 day')");
}

module.exports = { checkRateLimit, recordRequest, getActiveJobCount, cleanupRateLimitLog };
