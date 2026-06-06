const { logger, postgresBackup, cloudBackup, redis } = require('@sarathi/common');

async function runBackup() {
  const operationLock = 'lock:postgres_backup_operation';
  const lockToken = `scheduled-backup:${process.pid}:${Date.now()}`;
  const locked = await redis.set(operationLock, lockToken, 'EX', 1800, 'NX').catch(() => null);
  if (locked !== 'OK') {
    logger.info('scheduler', 'Skipping PostgreSQL backup because another backup or restore is running');
    return null;
  }

  try {
    logger.info('scheduler', 'Running PostgreSQL backup job...');
    const backup = await postgresBackup.createBackup('scheduled');

    if (backup && process.env.AUTO_CLOUD_BACKUP_ENABLED !== 'false') {
      try {
        const cloudResult = await cloudBackup.uploadToCloud(backup.path, backup.fileName);
        logger.info('scheduler', 'Automatic cloud backup finished', {
          fileName: backup.fileName,
          ok: cloudResult.ok,
          results: cloudResult.results,
          message: cloudResult.message || '',
        });
        return { ...backup, cloud: cloudResult };
      } catch (cloudErr) {
        logger.error('scheduler', 'Automatic cloud backup failed', {
          fileName: backup.fileName,
          error: cloudErr.message,
        });
      }
    }

    return backup;
  } catch (err) {
    logger.error('scheduler', 'PostgreSQL backup failed', { error: err.message });
    return null;
  } finally {
    await redis.eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
      1,
      operationLock,
      lockToken
    ).catch(() => {});
  }
}

module.exports = {
  runBackup,
};
