const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { logger } = require('@sarathi/common');

const BACKUP_DIR = path.resolve(__dirname, '../../../../data/backups');
const KEEP_RECENT = 5;
const KEEP_DAILY_DAYS = 7;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function rotateBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('pg_backup_') && f.endsWith('.dump'))
      .sort()
      .reverse(); // newest first

    const keep = new Set();

    // Keep the N most recent
    files.slice(0, KEEP_RECENT).forEach(f => keep.add(f));

    // Keep 1 per calendar day within the cutoff window
    const cutoffMs = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000;
    const dailySeen = new Set();
    for (const f of files) {
      const match = f.match(/pg_backup_(\d{4}-\d{2}-\d{2})/);
      if (!match) continue;
      const day = match[1];
      const dayMs = new Date(day).getTime();
      if (dayMs < cutoffMs) continue;
      if (!dailySeen.has(day) && dailySeen.size < KEEP_DAILY_DAYS) {
        dailySeen.add(day);
        keep.add(f);
      }
    }

    // Delete others
    for (const f of files) {
      if (!keep.has(f)) {
        const filePath = path.join(BACKUP_DIR, f);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.debug('scheduler', `Rotated old backup: ${f}`);
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    logger.warn('scheduler', `Backup rotation warning: ${err.message}`);
  }
}

async function runBackup() {
  logger.info('scheduler', 'Running PostgreSQL backup job...');
  ensureBackupDir();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.warn('scheduler', 'PostgreSQL backup skipped: DATABASE_URL not set');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `pg_backup_${timestamp}.dump`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);

  // Parse connection string to log safely
  let safeDbUrl = dbUrl;
  try {
    const parsed = new URL(dbUrl);
    parsed.password = '****';
    safeDbUrl = parsed.toString();
  } catch (_) {}

  logger.info('scheduler', `Starting pg_dump to ${backupFileName}`);

  // Use pg_dump tool
  const cmd = `pg_dump --dbname="${dbUrl}" -F c -b -v -f "${backupPath}"`;

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      logger.error('scheduler', `pg_dump failed: ${err.message}. Ensure pg_dump is installed and in path.`, { safeDbUrl });
      // Clean up empty file if created
      if (fs.existsSync(backupPath)) {
        try { fs.unlinkSync(backupPath); } catch (_) {}
      }
      return;
    }

    logger.info('scheduler', `PostgreSQL backup created successfully: ${backupFileName}`);
    rotateBackups();
  });
}

module.exports = {
  runBackup
};
