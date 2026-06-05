const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('./logger');

const BACKUP_DIR = path.resolve(__dirname, '../../../data/backups');
const KEEP_RECENT = 5;
const KEEP_DAILY_DAYS = 7;
const HEALTH_MAX_AGE_HOURS = Number(process.env.BACKUP_HEALTH_MAX_AGE_HOURS || 8);

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function isValidBackupName(fileName) {
  return /^pg_backup_[A-Za-z0-9_.-]+\.dump$/.test(fileName || '');
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  return fs.readdirSync(BACKUP_DIR)
    .filter(isValidBackupName)
    .map((fileName) => {
      const filePath = path.join(BACKUP_DIR, fileName);
      const stat = fs.statSync(filePath);
      return {
        fileName,
        path: filePath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        type: 'postgres',
        verified: stat.size > 0,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function rotateBackups() {
  try {
    const backups = listBackups();
    const keep = new Set(backups.slice(0, KEEP_RECENT).map((backup) => backup.fileName));
    const cutoffMs = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000;
    const dailySeen = new Set();

    for (const backup of backups) {
      const match = backup.fileName.match(/pg_backup_(\d{4}-\d{2}-\d{2})/);
      if (!match) continue;
      const day = match[1];
      const dayMs = new Date(day).getTime();
      if (dayMs < cutoffMs) continue;
      if (!dailySeen.has(day) && dailySeen.size < KEEP_DAILY_DAYS) {
        dailySeen.add(day);
        keep.add(backup.fileName);
      }
    }

    for (const backup of backups) {
      if (!keep.has(backup.fileName)) {
        try {
          fs.unlinkSync(backup.path);
          logger.debug('postgresBackup', 'Rotated old PostgreSQL backup', { fileName: backup.fileName });
        } catch (_) {}
      }
    }
  } catch (err) {
    logger.warn('postgresBackup', 'Backup rotation warning', { error: err.message });
  }
}

function getBackupHealth() {
  const backups = listBackups();
  const latest = backups[0] || null;
  const maxAgeMs = HEALTH_MAX_AGE_HOURS * 60 * 60 * 1000;
  const latestAgeMs = latest ? Date.now() - new Date(latest.createdAt).getTime() : null;
  const hasRecentBackup = latestAgeMs !== null && latestAgeMs <= maxAgeMs;
  const health = hasRecentBackup ? 'healthy' : (latest ? 'warning' : 'critical');
  const lastBackupAgoMinutes = latestAgeMs === null ? null : Math.floor(latestAgeMs / 60000);
  const nextScheduledAt = latest
    ? new Date(new Date(latest.createdAt).getTime() + 6 * 60 * 60 * 1000).toISOString()
    : null;

  return {
    ok: hasRecentBackup,
    health,
    backupDirectory: BACKUP_DIR,
    totalBackups: backups.length,
    lastBackup: latest,
    lastBackupAgoMinutes,
    nextScheduledAt,
    latestBackup: latest,
    latestAgeMs,
    maxAgeHours: HEALTH_MAX_AGE_HOURS,
    history: backups.slice(0, 10),
    message: hasRecentBackup
      ? 'Latest PostgreSQL backup is recent.'
      : (latest ? 'Latest PostgreSQL backup is older than expected.' : 'No PostgreSQL backup found.'),
  };
}

function buildPgDumpArgs(backupPath) {
  const dbUrl = process.env.DATABASE_URL || '';
  const hasDiscretePgConfig = Boolean(process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER || process.env.PGPASSWORD);

  if (!dbUrl && !hasDiscretePgConfig) {
    throw new Error('PostgreSQL backup is not configured. Set PGHOST/PGUSER/PGDATABASE/PGPASSWORD or DATABASE_URL.');
  }

  const args = ['-F', 'c', '-b', '-f', backupPath];
  const env = { ...process.env };
  let safeDbTarget = 'discrete-pg-env';

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
    try {
      const parsed = new URL(dbUrl);
      parsed.password = parsed.password ? '****' : '';
      safeDbTarget = parsed.toString();
    } catch (_) {}
  }

  return { args, env, safeDbTarget };
}

function buildPgRestoreArgs(backupPath) {
  const dbUrl = process.env.DATABASE_URL || '';
  const hasDiscretePgConfig = Boolean(process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER || process.env.PGPASSWORD);

  if (!dbUrl && !hasDiscretePgConfig) {
    throw new Error('PostgreSQL restore is not configured. Set PGHOST/PGUSER/PGDATABASE/PGPASSWORD or DATABASE_URL.');
  }

  const args = ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error'];
  const env = { ...process.env };
  let safeDbTarget = 'discrete-pg-env';

  if (hasDiscretePgConfig) {
    args.push(
      '-h', process.env.PGHOST || 'postgres',
      '-p', String(process.env.PGPORT || 5432),
      '-U', process.env.PGUSER || 'sarathi',
      '-d', process.env.PGDATABASE || 'sarathi'
    );
    if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;
  } else {
    args.push('--dbname', dbUrl);
    try {
      const parsed = new URL(dbUrl);
      parsed.password = parsed.password ? '****' : '';
      safeDbTarget = parsed.toString();
    } catch (_) {}
  }

  args.push(backupPath);
  return { args, env, safeDbTarget };
}

async function createBackup(type = 'manual') {
  ensureBackupDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `pg_backup_${timestamp}.dump`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const { args, env, safeDbTarget } = buildPgDumpArgs(filePath);

  logger.info('postgresBackup', 'Starting PostgreSQL backup', { fileName, type, safeDbTarget });

  await new Promise((resolve, reject) => {
    execFile('pg_dump', args, { env, timeout: 10 * 60 * 1000 }, (err) => {
      if (err) {
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
        reject(new Error(`pg_dump failed: ${err.message}`));
        return;
      }
      resolve();
    });
  });

  rotateBackups();
  const backup = listBackups().find((item) => item.fileName === fileName);
  logger.info('postgresBackup', 'PostgreSQL backup created', { fileName, type, sizeBytes: backup && backup.sizeBytes });
  return backup || { fileName, path: filePath, type: 'postgres', verified: fs.existsSync(filePath) };
}

async function verifyBackup(fileName) {
  if (!isValidBackupName(fileName)) throw new Error('Invalid backup file name');
  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error('Backup file not found');

  await new Promise((resolve, reject) => {
    execFile('pg_restore', ['--list', filePath], { timeout: 2 * 60 * 1000 }, (err) => {
      if (err) {
        reject(new Error(`Backup verification failed: ${err.message}`));
        return;
      }
      resolve();
    });
  });

  return true;
}

async function restoreBackup(fileName) {
  if (!isValidBackupName(fileName)) throw new Error('Invalid backup file name');

  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error('Backup file not found');

  await verifyBackup(fileName);
  const safetyBackup = await createBackup('restore-safety');
  const { args, env, safeDbTarget } = buildPgRestoreArgs(filePath);
  const db = require('./db');

  logger.warn('postgresBackup', 'Starting PostgreSQL restore', {
    fileName,
    safetyBackup: safetyBackup && safetyBackup.fileName,
    safeDbTarget,
  });

  try {
    await db.close();
    await new Promise((resolve, reject) => {
      execFile('pg_restore', args, { env, timeout: 15 * 60 * 1000 }, (err) => {
        if (err) {
          reject(new Error(`pg_restore failed: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  } finally {
    await db.reopen().catch(() => {});
  }

  logger.warn('postgresBackup', 'PostgreSQL restore completed', {
    fileName,
    safetyBackup: safetyBackup && safetyBackup.fileName,
  });

  return {
    ok: true,
    restoredFrom: fileName,
    safetyBackup,
  };
}

module.exports = {
  BACKUP_DIR,
  createBackup,
  getBackupHealth,
  isValidBackupName,
  listBackups,
  rotateBackups,
  restoreBackup,
  verifyBackup,
};
