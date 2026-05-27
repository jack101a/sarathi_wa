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
const serviceRepo = require('../services/serviceRepository');

// ─── Command category classification ────────────────────────────────────────

const LIGHT_COMMANDS = {
  has: (command) => getCommandCategory(command) === 'light'
};

const MEDIUM_COMMANDS = {
  has: (command) => getCommandCategory(command) === 'medium'
};

const HEAVY_COMMANDS = {
  has: (command) => getCommandCategory(command) === 'heavy'
};

/**
 * Classify a command into 'light' | 'medium' | 'heavy'.
 * Unrecognised commands default to 'light' (safest).
 */
function getCommandCategory(command) {
  const registry = serviceRepo.getServiceRegistrySync();
  const entry = registry.get(command);
  return entry ? entry.category : 'light';
}

function getCreditCost(command) {
  const registry = serviceRepo.getServiceRegistrySync();
  const entry = registry.get(command);
  if (entry && entry.credit_cost > 0) return entry.credit_cost;
  return CONFIG.CREDIT_COST.heavy || 50;
}

function isHeavyCommand(command) {
  return getCommandCategory(command) === 'heavy';
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
async function checkRateLimit(userId, planId, command) {
  // Check if service is globally active
  const registry = serviceRepo.getServiceRegistrySync();
  const entry = registry.get(command);
  if (entry && entry.is_active === 0) {
    return {
      allowed: false,
      reason: 'service_disabled',
      message: `🚧 *Service Under Maintenance*\n\nThe service '${entry.display_name || command}' is temporarily disabled by the administrator. Please try again later.`
    };
  }

  const category = getCommandCategory(command);
  const planKey  = planId || 'free';
  
  // ── Fetch dynamic plan from DB ──────────────────────────────────────────
  const [plan] = await query('SELECT * FROM subscription_plans WHERE id = ?', [planKey]);
  
  if (!plan) {
    // Fallback to config if DB plan doesn't exist yet
    const fallbackLimits = CONFIG.RATE_LIMITS[planKey] || CONFIG.RATE_LIMITS.standard;
    return applyLimits(userId, category, fallbackLimits, command);
  }
  
  if (!plan.is_active) {
    return { allowed: false, reason: 'plan_inactive', message: '⚠️ Your subscription plan is currently inactive.' };
  }

  // Check if service is included
  let services = [];
  try { services = JSON.parse(plan.services_json || '[]'); } catch(e) {}
  if (!services.includes('*') && !services.includes(command)) {
    return { 
      allowed: false, 
      reason: 'service_not_included', 
      message: `🚫 Access Denied\n\nThe command '${command}' is not included in your current plan (*${plan.name}*).\nPlease upgrade your plan to use this service.`
    };
  }

  // Parse limits
  let limits = CONFIG.RATE_LIMITS.standard;
  try { limits = JSON.parse(plan.limits_json || '{}'); } catch(e) {}
  
  return applyLimits(userId, category, limits, command);
}

async function applyLimits(userId, category, limits, command) {
  let effectiveLimits = { ...limits };
  try {
    const [userRow] = await query('SELECT rate_limit_overrides FROM auth_users WHERE id = ?', [userId]);
    if (userRow && userRow.rate_limit_overrides) {
      const overrides = JSON.parse(userRow.rate_limit_overrides || '{}');
      for (const cat of ['light', 'medium', 'heavy']) {
        if (overrides[cat]) {
          effectiveLimits[cat] = { ...(limits[cat] || {}), ...overrides[cat] };
        }
      }
      if (typeof overrides.maxConcurrent === 'number') {
        effectiveLimits.maxConcurrent = overrides.maxConcurrent;
      }
    }
  } catch (_) { /* ignore parse errors, use plan defaults */ }

  // ── Heavy: credit balance check only ──────────────────────────────────────
  if (category === 'heavy') {
    const [user] = await query('SELECT credits FROM auth_users WHERE id = ?', [userId]);
    const credits = Number((user && user.credits) || 0);
    const cost    = getCreditCost(command);
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
  const catLimits = effectiveLimits[category];
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
  getCreditCost,
  isHeavyCommand,
  LIGHT_COMMANDS,
  MEDIUM_COMMANDS,
  HEAVY_COMMANDS,
};
