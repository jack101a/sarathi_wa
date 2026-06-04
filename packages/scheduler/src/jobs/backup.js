const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
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

  const dbUrl = process.env.DATABASE_URL || '';
  const hasDiscretePgConfig = Boolean(process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER || process.env.PGPASSWORD);
  if (!dbUrl && !hasDiscretePgConfig) {
    logger.warn('scheduler', 'PostgreSQL backup skipped: database environment is not configured');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `pg_backup_${timestamp}.dump`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);

  // Parse connection string to log safely. Passwords must never be logged.
  let safeDbTarget = 'discrete-pg-env';
  try {
    if (dbUrl) {
      const parsed = new URL(dbUrl);
      parsed.password = parsed.password ? '****' : '';
      safeDbTarget = parsed.toString();
    }
  } catch (_) {}

  logger.info('scheduler', `Starting pg_dump to ${backupFileName}`);

  const args = ['-F', 'c', '-b', '-v', '-f', backupPath];
  const env = { ...process.env };

  if (hasDiscretePgConfig) {
    args.unshift(
      '-h', process.env.PGHOST || 'postgres',
      '-p', String(process.env.PGPORT || 5432),
      '-U', process.env.PGUSER || 'sarathi',
      '-d', process.env.PGDATABASE || 'sarathi'
    );
    if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;
  } else {
    args.unshift('--dbname', dbUrl);
  }

  await new Promise((resolve) => {
    execFile('pg_dump', args, { env, timeout: 10 * 60 * 1000 }, (err) => {
      if (err) {
        logger.error('scheduler', `pg_dump failed: ${err.message}. Ensure pg_dump is installed and the database credentials are correct.`, { safeDbTarget });
        if (fs.existsSync(backupPath)) {
          try { fs.unlinkSync(backupPath); } catch (_) {}
        }
        resolve();
        return;
      }

      logger.info('scheduler', `PostgreSQL backup created successfully: ${backupFileName}`);
      rotateBackups();
      resolve();
    });
  });
}

module.exports = {
  runBackup
};
