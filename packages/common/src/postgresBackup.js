const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('./logger');

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.resolve(__dirname, '../../../data/backups'));
const MANIFEST_PATH = path.join(BACKUP_DIR, 'backup_manifest.json');
const KEEP_RECENT = 5;
const KEEP_DAILY_DAYS = 7;
const HEALTH_MAX_AGE_HOURS = Number(process.env.BACKUP_HEALTH_MAX_AGE_HOURS || 8);
const MAX_IMPORT_BYTES = Number(process.env.BACKUP_IMPORT_MAX_BYTES || 256 * 1024 * 1024);
const PG_DUMP_BIN = process.env.PG_DUMP_BIN || 'pg_dump';
const PG_RESTORE_BIN = process.env.PG_RESTORE_BIN || 'pg_restore';
const PSQL_BIN = process.env.PSQL_BIN || 'psql';

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function readManifest() {
  ensureBackupDir();
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (_) {
    return { history: [] };
  }
}

function writeManifest(manifest) {
  ensureBackupDir();
  const tempPath = `${MANIFEST_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, MANIFEST_PATH);
}

function appendHistory(entry) {
  try {
    const manifest = readManifest();
    manifest.history = [entry, ...(manifest.history || [])].slice(0, 100);
    writeManifest(manifest);
  } catch (err) {
    logger.warn('postgresBackup', 'Failed to update backup manifest', { error: err.message });
  }
}

function isValidBackupName(fileName) {
  return /^pg_backup_[A-Za-z0-9_.-]+\.dump$/.test(fileName || '');
}

function getBackupMetadata() {
  const manifest = readManifest();
  const metadata = new Map();
  for (const entry of manifest.history || []) {
    if (entry.fileName && !metadata.has(entry.fileName)) metadata.set(entry.fileName, entry);
  }
  return metadata;
}

function listBackups() {
  ensureBackupDir();
  const metadata = getBackupMetadata();

  return fs.readdirSync(BACKUP_DIR)
    .filter(isValidBackupName)
    .map((fileName) => {
      const filePath = path.join(BACKUP_DIR, fileName);
      const stat = fs.statSync(filePath);
      const details = metadata.get(fileName) || {};
      return {
        fileName,
        path: filePath,
        sizeBytes: stat.size,
        createdAt: details.createdAt || stat.mtime.toISOString(),
        type: details.type || 'postgres',
        verified: details.verified !== undefined ? Boolean(details.verified) : null,
        sourceName: details.sourceName || null,
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
      const match = backup.fileName.match(/pg_backup_(?:imported_)?(\d{4}-\d{2}-\d{2})/);
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

function getPgConfig() {
  const dbUrl = process.env.DATABASE_URL || '';
  const hasDiscretePgConfig = Boolean(
    process.env.PGHOST
    || process.env.PGDATABASE
    || process.env.PGUSER
    || process.env.PGPASSWORD
  );

  if (!dbUrl && !hasDiscretePgConfig) {
    throw new Error('PostgreSQL backup is not configured. Set PGHOST/PGUSER/PGDATABASE/PGPASSWORD or DATABASE_URL.');
  }

  return { dbUrl, hasDiscretePgConfig, env: { ...process.env } };
}

function addDatabaseArgs(args, config) {
  let safeDbTarget = 'discrete-pg-env';
  if (config.hasDiscretePgConfig) {
    args.push(
      '-h', process.env.PGHOST || 'postgres',
      '-p', String(process.env.PGPORT || 5432),
      '-U', process.env.PGUSER || 'sarathi',
      '-d', process.env.PGDATABASE || 'sarathi'
    );
    if (process.env.PGPASSWORD) config.env.PGPASSWORD = process.env.PGPASSWORD;
  } else {
    args.push('--dbname', config.dbUrl);
    try {
      const parsed = new URL(config.dbUrl);
      parsed.password = parsed.password ? '****' : '';
      safeDbTarget = parsed.toString();
    } catch (_) {}
  }
  return safeDbTarget;
}

function buildPgDumpArgs(backupPath) {
  const config = getPgConfig();
  const args = [];
  const safeDbTarget = addDatabaseArgs(args, config);
  args.push('-F', 'c', '-b', '-f', backupPath);
  return { args, env: config.env, safeDbTarget };
}

function buildPgRestoreArgs(backupPath, options = {}) {
  const config = getPgConfig();
  const args = [];
  if (options.clean) {
    args.push('--clean', '--if-exists');
  }
  args.push('--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction');
  const safeDbTarget = addDatabaseArgs(args, config);
  args.push(backupPath);
  return { args, env: config.env, safeDbTarget };
}

function buildPsqlSchemaResetArgs() {
  const config = getPgConfig();
  const args = ['-X', '-v', 'ON_ERROR_STOP=1'];
  const safeDbTarget = addDatabaseArgs(args, config);
  args.push(
    '-c',
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO CURRENT_USER; GRANT USAGE ON SCHEMA public TO PUBLIC;'
  );
  return { args, env: config.env, safeDbTarget };
}

function runPgTool(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      timeout: options.timeout || 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: options.env || process.env,
    }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || stdout || err.message).trim();
        reject(new Error(`${path.basename(binary)} failed: ${detail || err.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function verifyBackupPath(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size <= 0) throw new Error('Backup file is empty');
  await runPgTool(PG_RESTORE_BIN, ['--list', filePath], { timeout: 2 * 60 * 1000 });
  return true;
}

async function createBackup(type = 'manual') {
  ensureBackupDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `pg_backup_${timestamp}.dump`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const { args, env, safeDbTarget } = buildPgDumpArgs(filePath);

  logger.info('postgresBackup', 'Starting PostgreSQL backup', { fileName, type, safeDbTarget });

  try {
    await runPgTool(PG_DUMP_BIN, args, { env, timeout: 10 * 60 * 1000 });
    await verifyBackupPath(filePath);
  } catch (err) {
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    appendHistory({
      success: false,
      type,
      fileName,
      error: err.message,
      createdAt: new Date().toISOString(),
    });
    throw err;
  }

  const stat = fs.statSync(filePath);
  const createdAt = stat.mtime.toISOString();
  appendHistory({
    success: true,
    type,
    fileName,
    sizeBytes: stat.size,
    verified: true,
    createdAt,
  });
  rotateBackups();

  const backup = listBackups().find((item) => item.fileName === fileName);
  logger.info('postgresBackup', 'PostgreSQL backup created and verified', {
    fileName,
    type,
    sizeBytes: backup && backup.sizeBytes,
  });
  return backup;
}

async function verifyBackup(fileName) {
  if (!isValidBackupName(fileName)) throw new Error('Invalid backup file name');
  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error('Backup file not found');
  return verifyBackupPath(filePath);
}

async function resetPublicSchema() {
  const { args, env, safeDbTarget } = buildPsqlSchemaResetArgs();
  logger.warn('postgresBackup', 'Resetting public schema before PostgreSQL restore', { safeDbTarget });
  await runPgTool(PSQL_BIN, args, { env, timeout: 2 * 60 * 1000 });
}

async function importBackup(sourceName, contents) {
  ensureBackupDir();
  const displayName = path.basename(String(sourceName || 'uploaded.dump'));
  if (!displayName.toLowerCase().endsWith('.dump')) {
    throw new Error('Only PostgreSQL custom-format .dump files can be imported');
  }
  if (!Buffer.isBuffer(contents) || contents.length === 0) {
    throw new Error('Uploaded backup file is empty');
  }
  if (contents.length > MAX_IMPORT_BYTES) {
    throw new Error(`Uploaded backup exceeds the ${Math.floor(MAX_IMPORT_BYTES / 1024 / 1024)} MB limit`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `pg_backup_imported_${timestamp}.dump`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const tempPath = `${filePath}.upload`;

  fs.writeFileSync(tempPath, contents, { mode: 0o600, flag: 'wx' });
  try {
    await verifyBackupPath(tempPath);
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    appendHistory({
      success: false,
      type: 'imported',
      sourceName: displayName,
      error: err.message,
      createdAt: new Date().toISOString(),
    });
    throw err;
  }

  const stat = fs.statSync(filePath);
  appendHistory({
    success: true,
    type: 'imported',
    fileName,
    sourceName: displayName,
    sizeBytes: stat.size,
    verified: true,
    createdAt: stat.mtime.toISOString(),
  });
  rotateBackups();
  logger.info('postgresBackup', 'PostgreSQL backup imported and verified', {
    fileName,
    sourceName: displayName,
    sizeBytes: stat.size,
  });
  return listBackups().find((item) => item.fileName === fileName);
}

async function restoreBackup(fileName) {
  if (!isValidBackupName(fileName)) throw new Error('Invalid backup file name');

  const filePath = path.join(BACKUP_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error('Backup file not found');

  await verifyBackup(fileName);
  const safetyBackup = await createBackup('restore-safety');
  const { args, env, safeDbTarget } = buildPgRestoreArgs(filePath);
  const db = require('./db');

  logger.warn('postgresBackup', 'Starting transactional PostgreSQL restore', {
    fileName,
    safetyBackup: safetyBackup && safetyBackup.fileName,
    safeDbTarget,
  });

  try {
    await db.close();
    await resetPublicSchema();
    await runPgTool(PG_RESTORE_BIN, args, { env, timeout: 15 * 60 * 1000 });
  } catch (err) {
    logger.error('postgresBackup', 'PostgreSQL restore failed; attempting safety backup rollback', {
      fileName,
      safetyBackup: safetyBackup && safetyBackup.fileName,
      error: err.message,
    });

    if (safetyBackup && safetyBackup.path) {
      try {
        await resetPublicSchema();
        const safetyRestore = buildPgRestoreArgs(safetyBackup.path);
        await runPgTool(PG_RESTORE_BIN, safetyRestore.args, { env: safetyRestore.env, timeout: 15 * 60 * 1000 });
        throw new Error(`${err.message}. Database was restored back to safety backup ${safetyBackup.fileName}.`);
      } catch (rollbackErr) {
        if (rollbackErr.message.includes('Database was restored back to safety backup')) {
          throw rollbackErr;
        }
        throw new Error(`${err.message}. Automatic safety restore failed: ${rollbackErr.message}. Safety backup: ${safetyBackup.fileName}`);
      }
    }

    throw err;
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
  buildPgDumpArgs,
  buildPgRestoreArgs,
  buildPsqlSchemaResetArgs,
  createBackup,
  getBackupHealth,
  importBackup,
  isValidBackupName,
  listBackups,
  rotateBackups,
  restoreBackup,
  verifyBackup,
};
