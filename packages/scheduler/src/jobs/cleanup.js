const fs = require('fs');
const path = require('path');
const { rateLimiter, jobRepository, logger } = require('@sarathi/common');

const TEMP_DIR = path.resolve(__dirname, '../../../../data/tmp');
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function cleanupTempFiles() {
  const cutoff = Date.now() - TEMP_FILE_MAX_AGE_MS;

  // Clean data/tmp/
  if (fs.existsSync(TEMP_DIR)) {
    try {
      const files = fs.readdirSync(TEMP_DIR);
      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            logger.debug('scheduler', `Deleted temp file: ${file}`);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Clean scattered status_*.png and temp_table_*.html from project root
  try {
    const files = fs.readdirSync(ROOT_DIR);
    for (const file of files) {
      if (!/^(status_.*\.png|temp_table_.*\.html)$/.test(file)) continue;
      const filePath = path.join(ROOT_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          logger.debug('scheduler', `Deleted stale root temp file: ${file}`);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

async function runCleanup() {
  logger.info('scheduler', 'Running workspace cleanup job...');
  
  // 1. Cleanup rate limit log
  try {
    await rateLimiter.cleanupRateLimitLog();
    logger.info('scheduler', 'Rate limit logs cleanup successful');
  } catch (err) {
    logger.error('scheduler', `Rate limit logs cleanup failed: ${err.message}`);
  }

  // 2. Cleanup old jobs (older than 30 days)
  try {
    await jobRepository.cleanupOldJobs(30);
    logger.info('scheduler', 'Old jobs cleanup successful');
  } catch (err) {
    logger.error('scheduler', `Old jobs cleanup failed: ${err.message}`);
  }

  // 3. Cleanup temp files
  try {
    cleanupTempFiles();
    logger.info('scheduler', 'Temporary files cleanup successful');
  } catch (err) {
    logger.error('scheduler', `Temporary files cleanup failed: ${err.message}`);
  }
}

module.exports = {
  runCleanup
};
