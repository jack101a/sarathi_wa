/**
 * Session manager responsibility:
 * Fetch and cache upstream session cookies using a pool of N independent sessions.
 * Under load, each session handles requests independently so the 50-request cap
 * per session is multiplied by POOL_SIZE.
 */

const CONFIG = require('../config/config');
const httpClient = require('./httpClient');
const logger = require('./logger');

const POOL_SIZE = CONFIG.SESSION_POOL_SIZE || 3;

/** @type {Array<{cookie: string|null, createdAt: number, requestCount: number, refreshing: boolean}>} */
const pool = Array.from({ length: POOL_SIZE }, () => ({
  cookie: null,
  createdAt: 0,
  requestCount: 0,
  refreshing: false,
}));

let nextIndex = 0;

function extractJSessionId(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const jsession = cookies.find((c) => c.startsWith('JSESSIONID='));
  if (!jsession) throw new Error('JSESSIONID not found in response cookies.');
  return jsession.split(';')[0];
}

async function _refreshSession(slot) {
  if (slot.refreshing) return;
  slot.refreshing = true;
  try {
    const homeUrl = CONFIG.URLS.HOME;
    if (!homeUrl) throw new Error('HOME_URL is not configured.');
    const response = await httpClient.get(homeUrl);
    const setCookieHeader = response.headers?.['set-cookie'];
    if (!setCookieHeader) throw new Error('Set-Cookie header missing in HOME response.');
    slot.cookie = extractJSessionId(setCookieHeader);
    slot.createdAt = Date.now();
    slot.requestCount = 1;
    logger.debug('sessionManager', 'Session refreshed', { poolSize: POOL_SIZE });
  } finally {
    slot.refreshing = false;
  }
}

function _isSlotValid(slot) {
  if (!slot.cookie || slot.refreshing) return false;
  const { TTL_MS, MAX_REQUESTS } = CONFIG.SESSION_CACHE;
  const ageMs = Date.now() - slot.createdAt;
  return ageMs < TTL_MS && slot.requestCount < MAX_REQUESTS;
}

/**
 * Acquire a valid session cookie from the pool using round-robin selection.
 * @returns {Promise<{cookie: string, slotIndex: number}>}
 */
async function acquireSession() {
  // Try up to POOL_SIZE slots starting from nextIndex (round-robin)
  for (let attempt = 0; attempt < POOL_SIZE; attempt++) {
    const index = (nextIndex + attempt) % POOL_SIZE;
    const slot = pool[index];
    if (_isSlotValid(slot)) {
      slot.requestCount++;
      nextIndex = (index + 1) % POOL_SIZE;
      logger.debug('sessionManager', `Using session slot ${index}`, { requestCount: slot.requestCount });
      return { cookie: slot.cookie, slotIndex: index };
    }
  }

  // No valid slot — refresh the next one in line
  const index = nextIndex % POOL_SIZE;
  const slot = pool[index];
  await _refreshSession(slot);
  nextIndex = (index + 1) % POOL_SIZE;
  return { cookie: slot.cookie, slotIndex: index };
}

/**
 * Legacy compatibility: single-cookie API for callers that haven't been updated yet.
 * @returns {Promise<string>}
 */
async function getSessionCookie() {
  const { cookie } = await acquireSession();
  return cookie;
}

function resetSession() {
  for (const slot of pool) {
    slot.cookie = null;
    slot.createdAt = 0;
    slot.requestCount = 0;
    slot.refreshing = false;
  }
  logger.info('sessionManager', 'All session slots reset');
}

function getPoolStatus() {
  return pool.map((slot, i) => ({
    index: i,
    hasSession: Boolean(slot.cookie),
    requestCount: slot.requestCount,
    ageMs: slot.createdAt ? Date.now() - slot.createdAt : 0,
    refreshing: slot.refreshing,
  }));
}

module.exports = {
  acquireSession,
  getSessionCookie,
  resetSession,
  getPoolStatus,
};
