/**
 * Global configuration loaded from a mounted YAML file plus environment overrides.
 *
 * The YAML file is intended to hold stable app/runtime configuration.
 * Environment variables are intended to hold operational secrets and deployment knobs.
 */

const fs = require('fs');
const dotenv = require('dotenv');
const path = require('path');
const YAML = require('yaml');

dotenv.config();

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const APP_ENV = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asBoolean(value, fallback) {
  if (typeof value === 'undefined' || value === null || value === '') {
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

function resolveProjectPath(value, fallbackRelativePath) {
  const candidate = String(value || '').trim();

  if (candidate) {
    return path.isAbsolute(candidate) ? candidate : path.join(PROJECT_ROOT, candidate);
  }

  return path.join(DATA_DIR, fallbackRelativePath);
}

function getConfigFilePath() {
  return resolveProjectPath(process.env.CONFIG_FILE, 'config.yml');
}

function getBundledDefaultConfigPath() {
  return path.join(PROJECT_ROOT, 'config.example.yml');
}

function getNestedValue(source, dottedPath) {
  return dottedPath.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return current[part];
  }, source);
}

function loadYamlConfig() {
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    const bundledDefaultPath = getBundledDefaultConfigPath();

    if (fs.existsSync(bundledDefaultPath)) {
      const targetDir = path.dirname(configPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.copyFileSync(bundledDefaultPath, configPath);
      console.log(`[config] Created default config file at ${configPath}`);
    } else {
      return {
        path: configPath,
        exists: false,
        data: {},
      };
    }
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = YAML.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Config file is empty or invalid: ${configPath}`);
  }

  return {
    path: configPath,
    exists: true,
    data: parsed,
  };
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
  SESSION_NAME: 'sarathi-session',
  AUTO_TRACK_CRON: '0 10-22/3 * * *',
};

const yamlConfig = loadYamlConfig();

function getConfigValue(envKey, yamlPath, fallback = '') {
  const envValue = process.env[envKey];
  if (typeof envValue !== 'undefined' && String(envValue).trim() !== '') {
    return envValue;
  }

  const yamlValue = getNestedValue(yamlConfig.data, yamlPath);
  if (typeof yamlValue !== 'undefined' && yamlValue !== null && String(yamlValue).trim() !== '') {
    return yamlValue;
  }

  return fallback;
}

const requiredCombinedConfig = [
  ['STATE_ID', 'state.id'],
  ['STATE_CODE', 'state.code'],
  ['HOME_URL', 'urls.home'],
  ['STATUS_URL', 'urls.status'],
  ['FORM_URL', 'urls.form'],
  ['ACK_URL', 'urls.ack'],
];

const missingCombinedConfig = requiredCombinedConfig.filter(
  ([envKey, yamlPath]) => !String(getConfigValue(envKey, yamlPath, '') || '').trim()
);

if (missingCombinedConfig.length > 0) {
  throw new Error(
    [
      yamlConfig.exists
        ? `Missing required config values in ${yamlConfig.path}:`
        : `Config file not found at ${yamlConfig.path}, and required values are also missing from env:`,
      ...missingCombinedConfig.map(([envKey, yamlPath]) => `- ${envKey} (yaml: ${yamlPath})`),
    ].join('\n')
  );
}

const whatsappPhoneNumber = String(process.env.WHATSAPP_PHONE_NUMBER || '').trim();
const telegramToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();

if (!whatsappPhoneNumber && !telegramToken && process.env.REQUIRE_CHAT_FRONTEND === 'true') {
  throw new Error(
    'At least one frontend must be configured: set WHATSAPP_PHONE_NUMBER or TELEGRAM_BOT_TOKEN.'
  );
}

const timeoutMs = asNumber(
  getConfigValue('TIMEOUT_MS', 'runtime.timeout_ms', DEFAULTS.TIMEOUT_MS),
  DEFAULTS.TIMEOUT_MS
);
const userAgent = String(
  getConfigValue('USER_AGENT', 'runtime.user_agent', DEFAULTS.USER_AGENT)
).trim() || DEFAULTS.USER_AGENT;
const sessionName = String(
  getConfigValue('SESSION_NAME', 'whatsapp.session_name', DEFAULTS.SESSION_NAME)
).trim() || DEFAULTS.SESSION_NAME;

const CONFIG = {
  APP_ENV,
  DATABASE_URL: process.env.DATABASE_URL || '',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  CONFIG_FILE_PATH: yamlConfig.path,
  PORT: asNumber(process.env.PORT, DEFAULTS.PORT),
  STATE_ID: String(getConfigValue('STATE_ID', 'state.id')).trim(),
  STATE_CODE: String(getConfigValue('STATE_CODE', 'state.code')).trim(),
  DAILY_FILLING: {
    ENABLED: asBoolean(process.env.DAILY_FILLING_ENABLED, false),
  },

  URLS: {
    HOME: String(getConfigValue('HOME_URL', 'urls.home', DEFAULTS.HOME_URL)).trim(),
    STATUS: String(getConfigValue('STATUS_URL', 'urls.status', DEFAULTS.STATUS_URL)).trim(),
    FORM: String(getConfigValue('FORM_URL', 'urls.form', DEFAULTS.FORM_URL)).trim(),
    ACK: String(getConfigValue('ACK_URL', 'urls.ack', DEFAULTS.ACK_URL)).trim(),
  },

  HTTP: {
    USER_AGENT: userAgent,
    TIMEOUT_MS: timeoutMs,
    HEADERS: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': userAgent,
    },
  },

  SESSION_CACHE: {
    MAX_REQUESTS: asNumber(
      getConfigValue('SESSION_MAX_REQUESTS', 'runtime.session_max_requests', DEFAULTS.SESSION_MAX_REQUESTS),
      DEFAULTS.SESSION_MAX_REQUESTS
    ),
    TTL_MS: asNumber(
      getConfigValue('SESSION_TTL_MS', 'runtime.session_ttl_ms', DEFAULTS.SESSION_TTL_MS),
      DEFAULTS.SESSION_TTL_MS
    ),
  },

  WHATSAPP: {
    ENABLED: Boolean(whatsappPhoneNumber),
    SESSION_NAME: sessionName,
    PHONE_NUMBER: whatsappPhoneNumber || null,
  },

  TELEGRAM: {
    ENABLED: Boolean(telegramToken),
    TOKEN: telegramToken || null,
    POLLING: asBoolean(getConfigValue('TELEGRAM_POLLING', 'telegram.polling', true), true),
    NOTIFY_CHAT_IDS: parseCsv(process.env.TELEGRAM_NOTIFY_CHAT_IDS || ''),
  },

  AUTO_TRACK: {
    CRON: String(
      getConfigValue('AUTO_TRACK_CRON', 'tracking.auto_track_cron', DEFAULTS.AUTO_TRACK_CRON)
    ).trim(),
    STORE_PATH: resolveProjectPath(
      process.env.AUTO_TRACK_STORE_FILE,
      'tracked_applications.json'
    ),
    UPDATE_CHAT_ID: String(process.env.AUTO_TRACK_UPDATE_CHAT_ID || '').trim() || null,
  },

  VAHAN_TRACK: {
    CRON: String(
      getConfigValue('VAHAN_TRACK_CRON', 'tracking.vahan_track_cron', process.env.AUTO_TRACK_CRON || DEFAULTS.AUTO_TRACK_CRON)
    ).trim(),
    STORE_PATH: resolveProjectPath(
      process.env.VAHAN_TRACK_STORE_FILE,
      'vahan_tracked_applications.json'
    ),
    UPDATE_CHAT_ID:
      String(process.env.VAHAN_TRACK_UPDATE_CHAT_ID || process.env.AUTO_TRACK_UPDATE_CHAT_ID || '').trim() || null,
    CAPTCHA_MODEL_PATH: path.isAbsolute(String(process.env.VAHAN_CAPTCHA_MODEL_PATH || '').trim())
      ? String(process.env.VAHAN_CAPTCHA_MODEL_PATH || '').trim()
      : path.join(
          PROJECT_ROOT,
          String(
            getConfigValue('VAHAN_CAPTCHA_MODEL_PATH', 'vahan.captcha_model_path', 'models/godmode_solver.onnx')
          ).trim()
        ),
    CAPTCHA_AUTO_SOLVE: asBoolean(
      getConfigValue('VAHAN_CAPTCHA_AUTO_SOLVE', 'vahan.captcha_auto_solve', true),
      true
    ),
    CAPTCHA_MAX_ATTEMPTS: asNumber(
      getConfigValue('VAHAN_CAPTCHA_MAX_ATTEMPTS', 'vahan.captcha_max_attempts', 8),
      8
    ),
    CAPTCHA_RETRY_MIN_MS: asNumber(
      getConfigValue('VAHAN_CAPTCHA_RETRY_MIN_MS', 'vahan.captcha_retry_min_ms', 3 * 1000),
      3 * 1000
    ),
    CAPTCHA_RETRY_MAX_MS: asNumber(
      getConfigValue('VAHAN_CAPTCHA_RETRY_MAX_MS', 'vahan.captcha_retry_max_ms', 5 * 1000),
      5 * 1000
    ),
  },

  TEMP: {
    DIR: resolveProjectPath(
      process.env.TEMP_DIR || getNestedValue(yamlConfig.data, 'runtime.temp_dir'),
      'tmp'
    ),
  },

  SECURITY: {
    AUTHORIZED_USERS: parseCsv(process.env.AUTHORIZED_USERS || ''),
    AUTHORIZED_GROUPS: parseCsv(process.env.AUTHORIZED_GROUPS || ''),
    AUTHORIZED_TG_USERS: parseCsv(process.env.AUTHORIZED_TG_USERS || ''),
    AUTHORIZED_TG_GROUPS: parseCsv(process.env.AUTHORIZED_TG_GROUPS || ''),
    ADMIN_USERS: parseCsv(process.env.ADMIN_USERS || ''),
    AUTHORIZED_TG_ADMINS: parseCsv(process.env.AUTHORIZED_TG_ADMINS || ''),
  },

  PUPPETEER: {
    HEADLESS: asBoolean(getConfigValue('PUPPETEER_HEADLESS', 'puppeteer.headless', true), true) ? 'new' : false,
    EXECUTABLE_PATH: String(getConfigValue('PUPPETEER_EXECUTABLE_PATH', 'puppeteer.executable_path', '')).trim(),
    DEFAULT_VIEWPORT: null,
    TIMEOUT_MS: timeoutMs,
    ARGS: parseCsv(
      process.env.PUPPETEER_ARGS ||
      getNestedValue(yamlConfig.data, 'puppeteer.args') ||
      ''
    ),
    DISABLE_SANDBOX: asBoolean(
      getConfigValue('PUPPETEER_DISABLE_SANDBOX', 'puppeteer.disable_sandbox', false),
      false
    ),
  },

  // ─────────────────────────────────────────────────────────────────────
  // Rate Limits: 3-category tiered model
  //
  //  LIGHT   — API/fetch commands: /track, /vahan, /form, /status, /appl
  //            Low CPU/RAM. 20 per day, 300 per month.
  //
  //  MEDIUM  — Browser commands with no destructive writes:
  //            /llprint, /feeprint, /payfee, /slotbooking, /resendotp
  //            5 per day, 60 per month.
  //
  //  HEAVY   — Professional / data-writing browser services:
  //            /lledit, /dlrenewal, /applydl (vehicle-class change), etc.
  //            Credit-based: 50 RS (credits) deducted per SUCCESSFUL job.
  //            No day/month cap — governed purely by credit balance.
  //
  //  No 'free' trial tier — every user must be explicitly activated.
  // ─────────────────────────────────────────────────────────────────────
  RATE_LIMITS: {
    standard: {
      light:  { perDay: 20,  perMonth: 300 },
      medium: { perDay: 5,   perMonth: 60  },
      heavy:  { perDay: 999, perMonth: 9999 }, // governed by credits, not quota
      maxConcurrent: 3,
    },
  },

  // Cost in credits deducted per successful heavy job.
  CREDIT_COST: {
    heavy: asNumber(process.env.CREDIT_COST_HEAVY, 50),
  },

  QUEUE: {
    API_CONCURRENCY:     asNumber(process.env.API_CONCURRENCY,     6),
    BROWSER_CONCURRENCY: asNumber(process.env.BROWSER_CONCURRENCY, 4),
    BROWSER_DELAY_MS:    asNumber(process.env.BROWSER_DELAY_MS,    3000),
    BROWSER_MAX_RETRIES: asNumber(process.env.BROWSER_MAX_RETRIES, 2),
    BROWSER_BACKOFF_MS:  asNumber(process.env.BROWSER_BACKOFF_MS,  5000),
  },

  SESSION_POOL_SIZE: asNumber(process.env.SESSION_POOL_SIZE, 3),
  MAX_BROWSER_PAGES: asNumber(process.env.MAX_BROWSER_PAGES, 5),

  ADMIN: {
    TOKEN:    String(process.env.ADMIN_TOKEN    || '').trim(),
    USERNAME: String(process.env.ADMIN_USERNAME || 'admin').trim(),
  },

  AI_PARSING: {
    ENABLED: asBoolean(process.env.AI_PARSING_ENABLED, false),
    API_BASE: String(process.env.LITELLM_API_BASE || 'http://localhost:4000/v1').trim(),
    API_KEY: String(process.env.LITELLM_API_KEY || '').trim(),
    MODEL: String(process.env.LITELLM_MODEL || 'gemini/gemini-1.5-flash').trim(),
  },

  DEBUG:     asBoolean(process.env.DEBUG,     false),
  LOG_LEVEL: String(process.env.LOG_LEVEL || 'info').trim().toLowerCase(),
};

module.exports = CONFIG;
