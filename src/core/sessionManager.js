/**
 * Session manager responsibility:
 * Fetch and cache upstream session cookies.
 */

const CONFIG = require('../config/config');
const httpClient = require('./httpClient');

let cachedCookie = null;
let createdAt = 0;
let requestCount = 0;

function debugLog(message) {
  if (CONFIG.DEBUG) {
    console.log(message);
  }
}

function extractJSessionId(setCookieHeader) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader];
  const jsession = cookies.find((cookie) => cookie.startsWith('JSESSIONID='));

  if (!jsession) {
    throw new Error('JSESSIONID not found in response cookies.');
  }

  return jsession.split(';')[0];
}

async function getSessionCookie() {
  const now = Date.now();
  const { TTL_MS, MAX_REQUESTS } = CONFIG.SESSION_CACHE;

  if (cachedCookie) {
    const ageMs = now - createdAt;

    if (ageMs < TTL_MS && requestCount < MAX_REQUESTS) {
      requestCount += 1;
      debugLog('Using cached session');
      return cachedCookie;
    }

    if (ageMs >= TTL_MS) {
      debugLog('Session expired by time');
    } else if (requestCount >= MAX_REQUESTS) {
      debugLog('Session expired by usage');
    }
  }

  const homeUrl = CONFIG.URLS.HOME;

  if (!homeUrl) {
    throw new Error('HOME_URL is not configured.');
  }

  const response = await httpClient.get(homeUrl);
  const setCookieHeader = response.headers?.['set-cookie'];

  if (!setCookieHeader) {
    throw new Error('Set-Cookie header missing in HOME response.');
  }

  cachedCookie = extractJSessionId(setCookieHeader);
  createdAt = Date.now();
  requestCount = 1;
  debugLog('New session created');

  return cachedCookie;
}

function resetSession() {
  cachedCookie = null;
  createdAt = 0;
  requestCount = 0;
}

module.exports = {
  getSessionCookie,
  resetSession,
};
