/**
 * cloudBackupSettings.js
 * DB-backed settings store for cloud backup providers.
 * Legacy compatibility module. Cloud backup settings are PostgreSQL-backed in production.
 */

const { query, run } = require('../core/db');

const PROVIDERS = ['telegram', 'rclone', 'r2'];

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  await run(`CREATE TABLE IF NOT EXISTS cloud_backup_settings (
    provider          TEXT PRIMARY KEY,
    enabled           INTEGER DEFAULT 0,
    config_json       TEXT    DEFAULT '{}',
    last_upload_at    TEXT    DEFAULT '',
    last_upload_status TEXT   DEFAULT '',
    last_error        TEXT    DEFAULT '',
    updated_at        TEXT    DEFAULT ''
  )`);
  // Seed rows for all providers so they always exist
  for (const p of PROVIDERS) {
    await run(
      `INSERT OR IGNORE INTO cloud_backup_settings (provider, enabled, config_json, updated_at)
       VALUES (?, 0, '{}', ?)`,
      [p, new Date().toISOString()]
    );
  }
  tableReady = true;
}

/**
 * Get settings for a single provider.
 * @returns {{ provider, enabled, config, lastUploadAt, lastUploadStatus, lastError, updatedAt }}
 */
async function getProviderSettings(provider) {
  await ensureTable();
  const rows = await query('SELECT * FROM cloud_backup_settings WHERE provider = ?', [provider]);
  if (!rows.length) return null;
  return _parseRow(rows[0]);
}

/**
 * Get settings for all 3 providers (credentials masked).
 */
async function getAllProviders(maskSecrets = true) {
  await ensureTable();
  const rows = await query('SELECT * FROM cloud_backup_settings ORDER BY provider');
  return rows.map(r => _parseRow(r, maskSecrets));
}

/**
 * Upsert provider settings.
 * @param {string} provider
 * @param {{ enabled?: boolean, config?: object }} updates
 */
async function updateProviderSettings(provider, { enabled, config } = {}) {
  await ensureTable();
  const existing = await getProviderSettings(provider);
  const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : (existing?.enabled ? 1 : 0);
  const newConfig  = config !== undefined ? JSON.stringify(config) : (existing?.rawConfig || '{}');
  await run(
    `INSERT INTO cloud_backup_settings (provider, enabled, config_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       enabled    = excluded.enabled,
       config_json = excluded.config_json,
       updated_at  = excluded.updated_at`,
    [provider, newEnabled, newConfig, new Date().toISOString()]
  );
  return getProviderSettings(provider);
}

/**
 * Record the result of a cloud upload attempt.
 */
async function updateUploadStatus(provider, status, error = '') {
  await ensureTable();
  await run(
    `UPDATE cloud_backup_settings
     SET last_upload_at = ?, last_upload_status = ?, last_error = ?
     WHERE provider = ?`,
    [new Date().toISOString(), status, String(error || '').slice(0, 500), provider]
  );
}

// ─── Internal ────────────────────────────────────────────────────────────────

function _parseRow(row, maskSecrets = false) {
  let config = {};
  try { config = JSON.parse(row.config_json || '{}'); } catch (_) {}

  if (maskSecrets) {
    config = _maskConfig(row.provider, config);
  }

  return {
    provider:          row.provider,
    enabled:           Boolean(row.enabled),
    config,
    rawConfig:         row.config_json || '{}',
    lastUploadAt:      row.last_upload_at   || null,
    lastUploadStatus:  row.last_upload_status || null,
    lastError:         row.last_error        || null,
    updatedAt:         row.updated_at        || null,
  };
}

function _maskConfig(provider, config) {
  const masked = { ...config };
  if (provider === 'r2') {
    if (masked.secretAccessKey) masked.secretAccessKey = '••••••••';
    if (masked.accessKeyId)     masked.accessKeyId     = masked.accessKeyId.slice(0, 4) + '••••••••';
  }
  return masked;
}

module.exports = {
  PROVIDERS,
  getProviderSettings,
  getAllProviders,
  updateProviderSettings,
  updateUploadStatus,
  ensureTable,
};
