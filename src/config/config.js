/**
 * Global configuration loaded from environment variables.
 *
 * This module is intentionally the single source of truth for runtime config.
 * It loads `.env`, validates required variables, and applies safe defaults.
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const APP_ENV = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asBoolean(value, fallback) {
  if (typeof value === 'undefined') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const DEFAULTS = {
  PORT: 3000,
  USER_AGENT:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  HOME_URL: 'https://sarathi.parivahan.gov.in/sarathiservice/',
  STATUS_URL: 'https://sarathi.parivahan.gov.in/sarathiservice/applStatus.do',
  FORM_URL: 'https://sarathi.parivahan.gov.in/sarathiservice/form2pdfreport.do',
  ACK_URL: 'https://sarathi.parivahan.gov.in/sarathiservice/printAck.do',
  TIMEOUT_MS: 60000,
  SESSION_MAX_REQUESTS: 50,
  SESSION_TTL_MS: 10 * 60 * 1000,
  WA_SESSION_ID: 'default-session',
  WA_AUTH_TIMEOUT_SEC: 60,
};

const REQUIRED_ENV_KEYS = [
  'HOME_URL',
  'STATUS_URL',
  'FORM_URL',
  'ACK_URL',
  'STATE_ID',
  'STATE_CODE',
];

const missing = REQUIRED_ENV_KEYS.filter((key) => !String(process.env[key] || '').trim());
if (missing.length > 0) {
  throw new Error(
    [
      'Missing required environment variables:',
      ...missing.map((key) => `- ${key}`),
      'Copy `.env.example` to `.env` and provide values before starting the app.',
    ].join('\n')
  );
}

const timeoutMs = asNumber(process.env.TIMEOUT_MS, DEFAULTS.TIMEOUT_MS);
const userAgent = process.env.USER_AGENT || DEFAULTS.USER_AGENT;
const sessionId = process.env.WA_SESSION_ID || DEFAULTS.WA_SESSION_ID;
const sessionRoot = process.env.SESSION_ROOT || process.cwd();
const sessionPath = path.join(sessionRoot, `${sessionId}.data.json`);

/**
 * Exported application configuration.
 */
const CONFIG = {
  // Runtime mode, used for logging and guardrails.
  APP_ENV,

  // Main application port for optional HTTP hosting.
  PORT: asNumber(process.env.PORT, DEFAULTS.PORT),

  // Sarathi state metadata used in portal workflows.
  STATE_ID: process.env.STATE_ID,
  STATE_CODE: process.env.STATE_CODE,

  // All external endpoints consumed by the bot.
  URLS: {
    HOME: process.env.HOME_URL || DEFAULTS.HOME_URL,
    STATUS: process.env.STATUS_URL || DEFAULTS.STATUS_URL,
    FORM: process.env.FORM_URL || DEFAULTS.FORM_URL,
    ACK: process.env.ACK_URL || DEFAULTS.ACK_URL,
  },

  // HTTP defaults shared by axios and browser requests.
  HTTP: {
    USER_AGENT: userAgent,
    TIMEOUT_MS: timeoutMs,
    HEADERS: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': userAgent,
    },
  },

  // In-memory session cache controls for upstream cookie refresh.
  SESSION_CACHE: {
    MAX_REQUESTS: asNumber(process.env.SESSION_MAX_REQUESTS, DEFAULTS.SESSION_MAX_REQUESTS),
    TTL_MS: asNumber(process.env.SESSION_TTL_MS, DEFAULTS.SESSION_TTL_MS),
  },

  // WhatsApp automation session/runtime options.
  WHATSAPP: {
    SESSION_ID: sessionId,
    SESSION_DATA_PATH: sessionPath,
    AUTH_TIMEOUT_SEC: asNumber(process.env.WA_AUTH_TIMEOUT_SEC, DEFAULTS.WA_AUTH_TIMEOUT_SEC),
    MULTI_DEVICE: asBoolean(process.env.WA_MULTI_DEVICE, true),
  },

  // Puppeteer launch options with Docker-friendly overrides.
  PUPPETEER: {
    HEADLESS: asBoolean(process.env.PUPPETEER_HEADLESS, true) ? 'new' : false,
    EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || '',
    DEFAULT_VIEWPORT: null,
    TIMEOUT_MS: timeoutMs,
    ARGS: parseCsv(process.env.PUPPETEER_ARGS),
    DISABLE_SANDBOX: asBoolean(process.env.PUPPETEER_DISABLE_SANDBOX, false),
  },

  DEBUG: asBoolean(process.env.DEBUG, false),
};

module.exports = CONFIG;
