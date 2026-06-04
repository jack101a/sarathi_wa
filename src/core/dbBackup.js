'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('./logger');

const BACKUP_DIR = path.resolve(__dirname, '../../data/backups');
const KEEP_RECENT = 5;
const KEEP_DAILY_DAYS = 7;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function isValidBackupName(fileName) {
  return /^pg_backup_[A-Za-z0-9_.-]+\.dump$/.test(fileName || '');
}

function backupPathOf(fileName) {
  return path.join(BACKUP_DIR, path.basename(fileName));
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(isValidBackupName)
    .map((fileName) => {
      const filePath = backupPathOf(fileName);
      const stat = fs.statSync(filePath);
      return {
        fileName,
        path: filePath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        type: 'postgres',
        verified: stat.size > 0
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function buildPgArgs(outputPath) {
  const dbUrl = process.env.DATABASE_URL || '';
  const hasDiscretePgConfig = Boolean(process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER || process.env.PGPASSWORD);
  if (!dbUrl && !hasDiscretePgConfig) {
    throw new Error('PostgreSQL backup is not configured. Set PGHOST/PGUSER/PGDATABASE/PGPASSWORD or DATABASE_URL.');
  }

  const args = ['-F', 'c', '-b', '-v', '-f', outputPath];
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

  return { args, env };
}

async function createBackup(type = 'manual') {
  ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `pg_backup_${timestamp}.dump`;
  const filePath = backupPathOf(fileName);
  const { args, env } = buildPgArgs(filePath);

  await new Promise((resolve, reject) => {
    execFile('pg_dump', args, { env, timeout: 10 * 60 * 1000 }, (err) => {
      if (err) {
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
        reject(err);
        return;
      }
      resolve();
    });
  });

  logger.info('dbBackup', `PostgreSQL backup created: ${fileName}`, { type });
  rotateBackups();
  return listBackups().find((backup) => backup.fileName === fileName);
}

async function verifyBackup(filePath) {
  const safeName = path.basename(filePath);
  if (!isValidBackupName(safeName)) throw new Error('Invalid backup file name');
  const fullPath = backupPathOf(safeName);
  if (!fs.existsSync(fullPath)) throw new Error(`Backup file not found: ${safeName}`);
  const stat = fs.statSync(fullPath);
  if (stat.size <= 0) throw new Error(`Backup file is empty: ${safeName}`);
  return true;
}

function rotateBackups() {
  const backups = listBackups();
  const keep = new Set(backups.slice(0, KEEP_RECENT).map((backup) => backup.fileName));
  const cutoffMs = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000;
  const dailySeen = new Set();

  for (const backup of backups) {
    const match = backup.fileName.match(/pg_backup_(\d{4}-\d{2}-\d{2})/);
    if (!match) continue;
    const day = match[1];
    if (new Date(day).getTime() < cutoffMs) continue;
    if (!dailySeen.has(day) && dailySeen.size < KEEP_DAILY_DAYS) {
      dailySeen.add(day);
      keep.add(backup.fileName);
    }
  }

  for (const backup of backups) {
    if (!keep.has(backup.fileName)) {
      try { fs.unlinkSync(backup.path); } catch (_) {}
    }
  }
}

function getBackupHealth() {
  const backups = listBackups();
  const last = backups[0] || null;
  return {
    health: last ? 'healthy' : 'warning',
    lastBackup: last,
    totalBackups: backups.length,
    oldestBackup: backups[backups.length - 1] || null,
    history: backups.slice(0, 10)
  };
}

async function restoreBackup(fileName) {
  const safeName = path.basename(fileName || '');
  if (!isValidBackupName(safeName)) throw new Error('Invalid backup file name');
  await verifyBackup(safeName);
  throw new Error('PostgreSQL restore is disabled from application runtime. Use pg_restore from a controlled maintenance shell.');
}

module.exports = { createBackup, listBackups, verifyBackup, restoreBackup, getBackupHealth, rotateBackups };
