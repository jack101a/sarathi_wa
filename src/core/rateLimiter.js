/**
 * Rate Limiter — 3-category per-user quota enforcement
 *
 * Command categories:
 *   LIGHT  — API/fetch commands (track, vahan, form, status, appl, etc.)
 *            20 per day, 300 per month.
 *
 *   MEDIUM — Browser info/print commands (llprint, feeprint, payfee, slotbooking, resendotp)
 *            5 per day, 60 per month.
 *
 *   HEAVY  — Professional browser data-writing commands (lledit, dlrenewal, apply_dl, etc.)
 *            No day/month cap. Governed by credit balance (50 RS deducted per success).
 */

const CONFIG = require('../config/config');
const { query, run } = require('./db');

// ─── Command category classification ────────────────────────────────────────

const LIGHT_COMMANDS = new Set([
  'track',
  'track_rc',
  'track_status',
  'add_track',
  'remove_track',
  'list_track',
  'refresh_track',
  'form1',
  'form1a',
  'form2',
  'formset',
  'alive',
  'vahan_track',
  'vahan_add',
  'vahan_remove',
  'vahan_list',
  'vahan_refresh',
]);

const MEDIUM_COMMANDS = new Set([
  'llprint_start',
  'fee_print_start',
  'pay_fee_start',
  'slot_booking_start',
  'resend_otp',
]);

const HEAVY_COMMANDS = new Set([
  'lledit_start',
  'dl_renewal_start',
  'apply_dl_start',
]);

/**
 * Classify a command into 'light' | 'medium' | 'heavy'.
 * Unrecognised commands default to 'light' (safest).
 */
function getCommandCategory(command) {
  if (HEAVY_COMMANDS.has(command))  return 'heavy';
  if (MEDIUM_COMMANDS.has(command)) return 'medium';
  return 'light';
}

// ─── In-memory cache (10-second TTL) ────────────────────────────────────────

const _cache = new Map();          // Map<userId, { counts, lastUpdated }>
const CACHE_TTL_MS = 10_000;

async function _loadCounts(userId) {
  const now = Date.now();
  const dayAgo   = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Per-category day counts
  const [lightDay]  = await query(
    "SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light'",
    [userId, dayAgo]
  );
  const [medDay]    = await query(
    "SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium'",
    [userId, dayAgo]
  );

  // Per-category month counts
  const [lightMon]  = await query(
    "SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='light'",
    [userId, monthAgo]
  );
  const [medMon]    = await query(
    "SELECT COUNT(*) AS c FROM rate_limit_log WHERE user_id=? AND timestamp>=? AND category='medium'",
    [userId, monthAgo]
  );

  return {
    light:  { perDay: Number(lightDay?.c  || 0), perMonth: Number(lightMon?.c  || 0) },
    medium: { perDay: Number(medDay?.c    || 0), perMonth: Number(medMon?.c    || 0) },
    lastUpdated: Date.now(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check all applicable limits for a user + command.
 * Returns { allowed: bool, reason: string }.
 */
async function checkRateLimit(userId, plan, command) {
  const category = getCommandCategory(command);
  const planKey  = plan || 'standard';
  const limits   = CONFIG.RATE_LIMITS[planKey] || CONFIG.RATE_LIMITS.standard;

  // ── Heavy: credit balance check only ──────────────────────────────────────
  if (category === 'heavy') {
    const [user] = await query('SELECT credits FROM auth_users WHERE id = ?', [userId]);
    const credits = Number((user && user.credits) || 0);
    const cost    = CONFIG.CREDIT_COST.heavy || 50;
    if (credits < cost) {
      return {
        allowed: false,
        reason: `credit_balance`,
        message: `⚠️ *Insufficient Credits*\n\nThis is a premium professional service.\n💰 Cost: *${cost} credits* per successful job.\n📊 Your balance: *${credits} credits*\n\nPlease contact admin to top up your balance.`,
      };
    }
    return { allowed: true, reason: '', category };
  }

  // ── Light / Medium: quota-based ────────────────────────────────────────────
  const catLimits = limits[category];
  if (!catLimits) return { allowed: true, reason: '', category };

  // Use cache if still fresh
  let counts;
  const cached = _cache.get(userId);
  if (cached && Date.now() - cached.lastUpdated < CACHE_TTL_MS) {
    counts = cached.counts;
  } else {
    counts = await _loadCounts(userId);
    _cache.set(userId, { counts, lastUpdated: Date.now() });
  }

  const used = counts[category] || { perDay: 0, perMonth: 0 };

  if (used.perDay >= catLimits.perDay) {
    return {
      allowed: false,
      reason: 'daily_limit',
      message: `⏳ Daily limit reached for *${category}* services.\nYou've used ${used.perDay}/${catLimits.perDay} today.\nLimit resets at midnight.`,
    };
  }
  if (used.perMonth >= catLimits.perMonth) {
    return {
      allowed: false,
      reason: 'monthly_limit',
      message: `📅 Monthly limit reached for *${category}* services.\nYou've used ${used.perMonth}/${catLimits.perMonth} this month.`,
    };
  }

  return { allowed: true, reason: '', category };
}

/**
 * Record a request (category auto-detected from command).
 * Invalidates the user's cache entry.
 */
async function recordRequest(userId, command) {
  const category = getCommandCategory(command);
  await run(
    'INSERT INTO rate_limit_log (user_id, timestamp, command, category) VALUES (?, ?, ?, ?)',
    [userId, new Date().toISOString(), String(command || ''), category]
  );
  _cache.delete(userId);
}

/**
 * Count active (pending + running) jobs for a user.
 */
async function getActiveJobCount(userId) {
  const [row] = await query(
    "SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND status IN ('pending','running')",
    [userId]
  );
  return Number((row && row.c) || 0);
}

/**
 * Cleanup log rows older than 30 days (called by billingCron, not per-request).
 */
async function cleanupRateLimitLog() {
  await run("DELETE FROM rate_limit_log WHERE timestamp < datetime('now', '-30 days')");
}

module.exports = {
  checkRateLimit,
  recordRequest,
  getActiveJobCount,
  cleanupRateLimitLog,
  getCommandCategory,
  LIGHT_COMMANDS,
  MEDIUM_COMMANDS,
  HEAVY_COMMANDS,
};
