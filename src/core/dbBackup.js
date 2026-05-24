const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { checkpoint } = require('./db');
const logger = require('./logger');

const DB_PATH = process.env.AUTHZ_DB_PATH || path.resolve(__dirname, '../../data/authz.sqlite');
const BACKUP_DIR = path.resolve(__dirname, '../../data/backups');
const MAX_BACKUPS = 5;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

async function createBackup() {
  ensureBackupDir();
  
  // Step 1: Checkpoint WAL to ensure all data is in main file
  try { await checkpoint(); } catch (err) {
    logger.warn('dbBackup', 'WAL checkpoint before backup failed', { error: err.message });
  }

  // Step 2: Copy database file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `authz_backup_${timestamp}.sqlite`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);

  try {
    fs.copyFileSync(DB_PATH, backupPath);
    logger.info('dbBackup', `Backup created: ${backupFileName}`);
  } catch (err) {
    logger.error('dbBackup', 'Backup copy failed', { error: err.message });
    throw err;
  }

  // Step 3: Verify backup integrity
  try {
    await verifyBackup(backupPath);
    logger.info('dbBackup', `Backup verified: ${backupFileName}`);
  } catch (err) {
    logger.error('dbBackup', 'Backup integrity check failed', { error: err.message });
    // Delete corrupt backup
    try { fs.unlinkSync(backupPath); } catch (_) {}
    throw err;
  }

  // Step 4: Rotate old backups
  rotateBackups();

  return { path: backupPath, fileName: backupFileName, timestamp };
}

function verifyBackup(backupPath) {
  return new Promise((resolve, reject) => {
    const testDb = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY);
    testDb.get('PRAGMA integrity_check', (err, row) => {
      testDb.close();
      if (err) return reject(err);
      if (row && row.integrity_check === 'ok') return resolve(true);
      reject(new Error(`Integrity check failed: ${JSON.stringify(row)}`));
    });
  });
}

function rotateBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('authz_backup_') && f.endsWith('.sqlite'))
      .sort()
      .reverse();

    // Keep only MAX_BACKUPS most recent
    for (let i = MAX_BACKUPS; i < files.length; i++) {
      const filePath = path.join(BACKUP_DIR, files[i]);
      try { fs.unlinkSync(filePath); } catch (_) {}
      logger.debug('dbBackup', `Rotated old backup: ${files[i]}`);
    }
  } catch (_) {}
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('authz_backup_') && f.endsWith('.sqlite'))
    .sort()
    .reverse()
    .map(f => ({
      fileName: f,
      path: path.join(BACKUP_DIR, f),
      sizeBytes: fs.statSync(path.join(BACKUP_DIR, f)).size,
      createdAt: fs.statSync(path.join(BACKUP_DIR, f)).mtime.toISOString(),
    }));
}

module.exports = { createBackup, listBackups, verifyBackup };
