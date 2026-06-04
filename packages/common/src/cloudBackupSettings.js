'use strict';

const { query } = require('./db');
const logger = require('./logger');

const PROVIDERS = ['telegram', 'rclone', 'r2'];

const DEFAULT_CONFIGS = {
  telegram: {
    enabled: false,
    config: { chatIds: [] },
    lastUploadAt: null,
    lastUploadStatus: '',
    lastError: ''
  },
  rclone: {
    enabled: false,
    config: { remote: '', path: 'sarathiwa-backups' },
    lastUploadAt: null,
    lastUploadStatus: '',
    lastError: ''
  },
  r2: {
    enabled: false,
    config: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '', region: 'auto' },
    lastUploadAt: null,
    lastUploadStatus: '',
    lastError: ''
  }
};

let initialized = false;

function validateProvider(provider) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported cloud backup provider: ${provider}`);
  }
}

function normalizeRow(provider, row) {
  const fallback = DEFAULT_CONFIGS[provider];
  if (!row) return { provider, ...fallback };

  return {
    provider,
    enabled: Boolean(Number(row.enabled || 0)),
    config: row.config_json || fallback.config,
    lastUploadAt: row.last_upload_at ? new Date(row.last_upload_at).toISOString() : null,
    lastUploadStatus: row.last_upload_status || '',
    lastError: row.last_error || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

async function ensureTable() {
  if (initialized) return;

  await query(`
    CREATE TABLE IF NOT EXISTS cloud_backup_settings (
      provider VARCHAR(50) PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_upload_at TIMESTAMPTZ,
      last_upload_status VARCHAR(50) NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const provider of PROVIDERS) {
    await query(
      `INSERT INTO cloud_backup_settings (provider, enabled, config_json)
       VALUES (?, ?, ?::jsonb)
       ON CONFLICT (provider) DO NOTHING`,
      [provider, DEFAULT_CONFIGS[provider].enabled ? 1 : 0, JSON.stringify(DEFAULT_CONFIGS[provider].config)]
    );
  }

  initialized = true;
}

async function getProvider(provider) {
  validateProvider(provider);
  await ensureTable();
  const rows = await query('SELECT * FROM cloud_backup_settings WHERE provider = ?', [provider]);
  return normalizeRow(provider, rows[0]);
}

async function getAllProviders(includeSecrets = false) {
  await ensureTable();
  const rows = await query('SELECT * FROM cloud_backup_settings ORDER BY provider ASC');
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  const providers = {};

  for (const provider of PROVIDERS) {
    const item = normalizeRow(provider, byProvider.get(provider));
    if (!includeSecrets && provider === 'r2' && item.config.secretAccessKey) {
      item.config = { ...item.config, secretAccessKey: '***' };
    }
    providers[provider] = item;
  }

  return providers;
}

async function updateProvider(provider, patch = {}) {
  validateProvider(provider);
  await ensureTable();

  const current = await getProvider(provider);
  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled;
  const configPatch = patch.config && typeof patch.config === 'object' ? patch.config : {};
  const config = { ...current.config, ...configPatch };

  if (provider === 'r2' && configPatch.secretAccessKey === '***') {
    config.secretAccessKey = current.config.secretAccessKey || '';
  }

  await query(
    `UPDATE cloud_backup_settings
     SET enabled = ?, config_json = ?::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE provider = ?`,
    [enabled ? 1 : 0, JSON.stringify(config), provider]
  );

  logger.info('cloudBackupSettings', 'Cloud backup provider updated', { provider, enabled });
  return getProvider(provider);
}

async function recordUploadStatus(provider, status, errorMessage = '') {
  validateProvider(provider);
  await ensureTable();
  await query(
    `UPDATE cloud_backup_settings
     SET last_upload_at = CURRENT_TIMESTAMP,
         last_upload_status = ?,
         last_error = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE provider = ?`,
    [status || '', errorMessage || '', provider]
  );
}

module.exports = {
  PROVIDERS,
  ensureTable,
  getProvider,
  getAllProviders,
  updateProvider,
  recordUploadStatus
};
