const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarathi-pg-backup-'));
const fakeRestore = path.join(tempDir, 'pg_restore');

fs.writeFileSync(fakeRestore, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.BACKUP_DIR = tempDir;
process.env.PG_RESTORE_BIN = fakeRestore;
process.env.PGHOST = 'postgres';
process.env.PGPORT = '5432';
process.env.PGDATABASE = 'sarathi';
process.env.PGUSER = 'sarathi';
process.env.PGPASSWORD = 'test-password';

const postgresBackup = require('../packages/common/src/postgresBackup');

async function run() {
  const restoreArgs = postgresBackup.buildPgRestoreArgs('/tmp/backup.dump').args;
  assert(restoreArgs.includes('--single-transaction'), 'restore must be atomic');
  assert(!restoreArgs.includes('--clean'), 'restore should replay into a pre-cleaned schema');
  assert(restoreArgs.includes('--exit-on-error'), 'restore must stop on the first error');

  const schemaResetArgs = postgresBackup.buildPsqlSchemaResetArgs().args;
  assert(schemaResetArgs.includes('ON_ERROR_STOP=1'), 'schema reset must stop on the first error');
  assert(
    schemaResetArgs.some((arg) => /DROP SCHEMA IF EXISTS public CASCADE/.test(arg)),
    'schema reset must cascade-drop target-only dependencies before restore'
  );

  assert.strictEqual(postgresBackup.isValidBackupName('pg_backup_2026.dump'), true);
  assert.strictEqual(postgresBackup.isValidBackupName('../pg_backup_2026.dump'), false);
  assert.strictEqual(postgresBackup.isValidBackupName('backup.dump'), false);

  const imported = await postgresBackup.importBackup('downloaded.dump', Buffer.from('test dump'));
  assert(imported.fileName.startsWith('pg_backup_imported_'));
  assert.strictEqual(imported.type, 'imported');
  assert.strictEqual(imported.verified, true);
  assert.strictEqual(imported.sourceName, 'downloaded.dump');
  assert.strictEqual(postgresBackup.listBackups().length, 1);

  await assert.rejects(
    () => postgresBackup.importBackup('downloaded.sqlite', Buffer.from('not a pg dump')),
    /Only PostgreSQL custom-format/
  );
  await assert.rejects(
    () => postgresBackup.importBackup('empty.dump', Buffer.alloc(0)),
    /empty/
  );

  console.log('PostgreSQL backup smoke tests passed.');
}

run()
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
