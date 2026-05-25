const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { checkpoint, dbPath } = require('./db');
const logger = require('./logger');

const BACKUP_DIR = path.resolve(__dirname, '../../data/backups');
const MANIFEST_PATH = path.join(BACKUP_DIR, 'backup_manifest.json');

// Tiered retention: keep this many "frequent" backups regardless of age
const KEEP_RECENT = 5;
// Additionally keep 1 backup per day for this many days
const KEEP_DAILY_DAYS = 7;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Read the manifest JSON, or return an empty default. */
function readManifest() {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    }
  } catch (_) {}
  return { lastBackup: null, history: [] };
}

/** Write the manifest JSON atomically using a temp file + rename. */
function writeManifest(manifest) {
  try {
    const tmp = MANIFEST_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(tmp, MANIFEST_PATH);
  } catch (err) {
    logger.warn('dbBackup', 'Failed to write backup manifest', { error: err.message });
  }
}

/** Append a backup result to the manifest history (keep last 50 entries). */
function appendManifest(entry) {
  const manifest = readManifest();
  if (entry.success) manifest.lastBackup = entry;
  manifest.history = [entry, ...(manifest.history || [])].slice(0, 50);
  writeManifest(manifest);
}

// ─── Core Backup ──────────────────────────────────────────────────────────────

/**
 * Create a backup of the live database.
 * @param {string} type - One of: 'manual' | 'scheduled' | 'startup' | 'shutdown'
 */
async function createBackup(type = 'manual') {
  ensureBackupDir();

  // Step 1: Checkpoint WAL → main file
  try {
    await checkpoint();
  } catch (err) {
    logger.warn('dbBackup', 'WAL checkpoint before backup failed', { error: err.message });
  }

  // Step 2: Build timestamped filename and copy
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `authz_backup_${timestamp}.sqlite`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);

  try {
    fs.copyFileSync(dbPath, backupPath);
    logger.info('dbBackup', `Backup file created: ${backupFileName}`, { type });
  } catch (err) {
    logger.error('dbBackup', 'Backup copy failed', { error: err.message });
    appendManifest({ success: false, type, error: err.message, timestamp: new Date().toISOString() });
    throw err;
  }

  // Step 3: Verify backup integrity
  let verified = false;
  try {
    await verifyBackup(backupPath);
    verified = true;
    logger.info('dbBackup', `Backup verified OK: ${backupFileName}`);
  } catch (err) {
    logger.error('dbBackup', 'Backup integrity check failed — deleting corrupt backup', { error: err.message });
    _deleteBackupFiles(backupPath);
    appendManifest({ success: false, type, error: `Integrity check failed: ${err.message}`, timestamp: new Date().toISOString() });
    throw err;
  }

  // Step 4: Tiered rotation
  rotateBackups();

  const entry = {
    success: true,
    type,
    verified,
    fileName: backupFileName,
    path: backupPath,
    sizeBytes: fs.statSync(backupPath).size,
    timestamp: new Date().toISOString(),
  };
  appendManifest(entry);

  // Step 5: Fire-and-forget cloud upload (non-blocking — local backup always succeeds)
  setImmediate(() => {
    try {
      const { uploadToCloud } = require('./cloudBackup');
      uploadToCloud(backupPath, backupFileName).catch(err => {
        logger.warn('dbBackup', 'Cloud upload error', { error: err.message });
      });
    } catch (_) {}
  });

  return entry;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

function verifyBackup(backupPath) {
  return new Promise((resolve, reject) => {
    const testDb = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
    });
    testDb.get('PRAGMA integrity_check', (err, row) => {
      testDb.close();
      if (err) return reject(err);
      if (row && row.integrity_check === 'ok') return resolve(true);
      reject(new Error(`Integrity check failed: ${JSON.stringify(row)}`));
    });
  });
}

// ─── Tiered Rotation ──────────────────────────────────────────────────────────

/**
 * Tiered retention:
 *  - Keep the KEEP_RECENT most-recent backups unconditionally.
 *  - Also keep 1 backup per calendar day for KEEP_DAILY_DAYS days.
 *  - Delete everything else (including -shm and -wal companions).
 */
function rotateBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('authz_backup_') && f.endsWith('.sqlite'))
      .sort()
      .reverse(); // newest first

    const keep = new Set();

    // Always keep the N most recent
    files.slice(0, KEEP_RECENT).forEach(f => keep.add(f));

    // Keep 1 per calendar day, but only within the last KEEP_DAILY_DAYS days
    const cutoffMs = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000;
    const dailySeen = new Set();
    for (const f of files) {
      // filename: authz_backup_2026-05-25T05-00-00-000Z.sqlite
      const match = f.match(/authz_backup_(\d{4}-\d{2}-\d{2})/);
      if (!match) continue;
      const day = match[1];
      const dayMs = new Date(day).getTime();
      // Only apply daily retention for days within the cutoff window
      if (dayMs < cutoffMs) continue;
      if (!dailySeen.has(day) && dailySeen.size < KEEP_DAILY_DAYS) {
        dailySeen.add(day);
        keep.add(f);
      }
    }

    // Delete files not in keep set
    for (const f of files) {
      if (!keep.has(f)) {
        const filePath = path.join(BACKUP_DIR, f);
        _deleteBackupFiles(filePath);
        logger.debug('dbBackup', `Rotated old backup: ${f}`);
      }
    }
  } catch (err) {
    logger.warn('dbBackup', 'Rotation error', { error: err.message });
  }
}

/** Delete a .sqlite backup and its -shm / -wal companions (fixes the orphaned file bug). */
function _deleteBackupFiles(filePath) {
  for (const ext of ['', '-shm', '-wal']) {
    const p = filePath + ext;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

function listBackups() {
  ensureBackupDir();
  const manifest = readManifest();
  const historyMap = {};
  for (const h of (manifest.history || [])) {
    if (h.fileName && !historyMap[h.fileName]) historyMap[h.fileName] = h;
  }

  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('authz_backup_') && f.endsWith('.sqlite'))
    .sort()
    .reverse()
    .map(f => {
      const fullPath = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(fullPath);
      const meta = historyMap[f] || {};
      return {
        fileName: f,
        path: fullPath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        type: meta.type || 'unknown',
        verified: meta.verified !== undefined ? meta.verified : null,
      };
    });
}

// ─── Backup Health ────────────────────────────────────────────────────────────

function getBackupHealth() {
  ensureBackupDir();
  const manifest = readManifest();
  const backups = listBackups();

  const last = manifest.lastBackup;
  let health = 'critical';
  let lastBackupAgo = null;

  if (last && last.timestamp) {
    const ageMs = Date.now() - new Date(last.timestamp).getTime();
    lastBackupAgo = Math.floor(ageMs / 1000 / 60); // minutes
    if (ageMs < 7 * 60 * 60 * 1000)  health = 'healthy';  // < 7h
    else if (ageMs < 13 * 60 * 60 * 1000) health = 'warning'; // 7-13h
    else health = 'critical';
  }

  // Next scheduled is every 6 hours from last successful backup
  let nextScheduledAt = null;
  if (last && last.timestamp) {
    const lastMs = new Date(last.timestamp).getTime();
    nextScheduledAt = new Date(lastMs + 6 * 60 * 60 * 1000).toISOString();
  }

  const oldest = backups.length > 0 ? backups[backups.length - 1] : null;

  return {
    health,
    lastBackup: last,
    lastBackupAgoMinutes: lastBackupAgo,
    nextScheduledAt,
    totalBackups: backups.length,
    oldestBackup: oldest ? { fileName: oldest.fileName, createdAt: oldest.createdAt } : null,
    history: (manifest.history || []).slice(0, 10),
  };
}

// ─── Restore ──────────────────────────────────────────────────────────────────

/**
 * Restore a backup file over the live database.
 * Flow:
 *   1. Validate fileName (no path traversal, must be a known backup)
 *   2. Verify integrity of backup before doing anything destructive
 *   3. Create a "pre-restore safety backup" of current live DB
 *   4. Close live DB connection
 *   5. Copy backup file over live DB path
 *   6. Reopen live DB connection
 * @param {string} fileName - Just the filename (not a path)
 */
async function restoreBackup(fileName) {
  // Sanitise — strip any path components
  const safeName = path.basename(fileName);
  if (!safeName.startsWith('authz_backup_') || !safeName.endsWith('.sqlite')) {
    throw new Error('Invalid backup file name');
  }

  const backupPath = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${safeName}`);
  }

  // Step 1: Verify the backup we're restoring is intact
  logger.info('dbBackup', `Restore requested: verifying ${safeName}`);
  await verifyBackup(backupPath);

  // Step 2: Create a safety backup of current live DB
  logger.info('dbBackup', 'Creating pre-restore safety backup of live DB');
  let safetyBackup = null;
  try {
    safetyBackup = await createBackup('restore-safety');
  } catch (err) {
    logger.warn('dbBackup', 'Pre-restore safety backup failed — proceeding anyway', { error: err.message });
  }

  // Step 3: Close DB, replace file, reopen
  const { close, reopen } = require('./db');
  logger.info('dbBackup', 'Closing live DB connection for restore');
  await close();

  try {
    fs.copyFileSync(backupPath, dbPath);
    logger.info('dbBackup', `Restored ${safeName} → ${dbPath}`);
  } catch (err) {
    logger.error('dbBackup', 'File copy during restore failed', { error: err.message });
    // Try to reopen even on failure so the server isn't left with no DB
    try { await reopen(); } catch (_) {}
    throw err;
  }

  // Step 4: Reopen live connection
  await reopen();
  logger.info('dbBackup', 'DB connection reopened after restore');

  return {
    restoredFrom: safeName,
    safetyBackup: safetyBackup ? safetyBackup.fileName : null,
    timestamp: new Date().toISOString(),
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { createBackup, listBackups, verifyBackup, restoreBackup, getBackupHealth, rotateBackups };
