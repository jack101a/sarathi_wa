const { logger, postgresBackup, cloudBackup } = require('@sarathi/common');

async function runBackup() {
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
  }
}

module.exports = {
  runBackup,
};
