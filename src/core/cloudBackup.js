/**
 * cloudBackup.js
 * Provider adapters for cloud backup upload.
 * Providers: telegram | rclone (GDrive) | r2 (Cloudflare R2)
 *
 * All adapters receive (filePath, fileName, config) and return a result string.
 * Failures throw descriptive errors.
 */

const fs           = require('fs');
const path         = require('path');
const { execFileSync } = require('child_process');
const logger       = require('./logger');
const chatNotifier = require('../services/chatNotifier');
const cloudSettings = require('../services/cloudBackupSettings');

// ─── Telegram Adapter ─────────────────────────────────────────────────────────

/**
 * Upload backup via Telegram bot as a document.
 * Uses the existing activeTelegramBot from chatNotifier.
 * Telegram bot API limit: 50 MB — our DB is ~220 KB so always safe.
 *
 * @param {string} filePath
 * @param {string} fileName
 * @param {{ chatId: string }} config
 */
async function uploadViaTelegram(filePath, fileName, config) {
  const { chatId } = config;
  if (!chatId) throw new Error('Telegram chatId is not configured');

  const buffer = fs.readFileSync(filePath);
  const sizeKB  = (buffer.length / 1024).toFixed(1);
  const caption = `📦 *DB Backup*\n\`${fileName}\`\n💾 ${sizeKB} KB\n🕐 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

  await chatNotifier.sendTelegramDocument(
    String(chatId),
    buffer,
    fileName,
    caption,
    'application/x-sqlite3'
  );

  logger.info('cloudBackup', `Telegram upload OK → chat ${chatId}`, { fileName });
  return `Sent to chat ${chatId}`;
}

// ─── Rclone (GDrive) Adapter ──────────────────────────────────────────────────

/**
 * Upload backup via rclone to a Google Drive (or any rclone remote).
 * Requires rclone to be installed and configured on the server.
 *
 * @param {string} filePath
 * @param {string} fileName
 * @param {{ remote: string, remotePath: string }} config
 */
async function uploadViaRclone(filePath, fileName, config) {
  const remote     = String(config.remote     || 'gdrive').trim();
  const remotePath = String(config.remotePath || 'SarathiBackups').trim();

  // Verify rclone is available
  try {
    execFileSync('rclone', ['version'], { timeout: 10_000, stdio: 'pipe' });
  } catch (_) {
    throw new Error('rclone is not installed or not in PATH. Install it from https://rclone.org/install/');
  }

  const dest = `${remote}:${remotePath}`;
  try {
    execFileSync('rclone', ['copy', filePath, dest, '--no-traverse'], {
      timeout: 120_000,
      stdio: 'pipe',
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    throw new Error(`rclone copy failed: ${stderr}`);
  }

  logger.info('cloudBackup', `Rclone upload OK → ${dest}`, { fileName });
  return `Copied to ${dest}/${fileName}`;
}

/**
 * Check if rclone is installed (for UI status display).
 */
function checkRcloneInstalled() {
  try {
    const out = execFileSync('rclone', ['version'], { timeout: 5_000, stdio: 'pipe' });
    const version = out.toString().split('\n')[0].trim();
    return { installed: true, version };
  } catch (_) {
    return { installed: false, version: null };
  }
}

// ─── Cloudflare R2 Adapter ────────────────────────────────────────────────────

/**
 * Upload backup to Cloudflare R2 via S3-compatible API.
 * Lazy-requires @aws-sdk/client-s3 so the module loads even if sdk is not installed.
 *
 * @param {string} filePath
 * @param {string} fileName
 * @param {{ accountId: string, accessKeyId: string, secretAccessKey: string, bucketName: string }} config
 */
async function uploadViaR2(filePath, fileName, config) {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = config;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('R2 config incomplete — need accountId, accessKeyId, secretAccessKey, bucketName');
  }

  let S3Client, PutObjectCommand;
  try {
    ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
  } catch (_) {
    throw new Error('@aws-sdk/client-s3 is not installed. Run: npm install @aws-sdk/client-s3');
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const fileStream = fs.createReadStream(filePath);
  const fileStat   = fs.statSync(filePath);

  await client.send(new PutObjectCommand({
    Bucket:        bucketName,
    Key:           `backups/${fileName}`,
    Body:          fileStream,
    ContentLength: fileStat.size,
    ContentType:   'application/x-sqlite3',
    Metadata: {
      'backup-source': 'sarathiwa-bot',
      'backup-date':   new Date().toISOString(),
    },
  }));

  logger.info('cloudBackup', `R2 upload OK → ${bucketName}/backups/${fileName}`);
  return `Uploaded to r2://${bucketName}/backups/${fileName}`;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

const ADAPTERS = {
  telegram: uploadViaTelegram,
  rclone:   uploadViaRclone,
  r2:       uploadViaR2,
};

/**
 * Upload a backup file to all enabled cloud providers.
 * Each provider runs independently — one failure does not stop others.
 * Results are persisted back to cloud_backup_settings.
 *
 * @param {string} filePath   Absolute path to the .sqlite backup file
 * @param {string} fileName   Just the filename (for caption/key)
 * @returns {Promise<Array<{ provider, ok, result?, error? }>>}
 */
async function uploadToCloud(filePath, fileName) {
  const providers = await cloudSettings.getAllProviders(false); // unmask secrets
  const results   = [];

  for (const p of providers) {
    if (!p.enabled) continue;

    const adapter = ADAPTERS[p.provider];
    if (!adapter) continue;

    let config = {};
    try { config = JSON.parse(p.rawConfig || '{}'); } catch (_) {}

    try {
      const result = await adapter(filePath, fileName, config);
      await cloudSettings.updateUploadStatus(p.provider, 'success');
      results.push({ provider: p.provider, ok: true, result });
      logger.info('cloudBackup', `${p.provider} upload succeeded`, { fileName });
    } catch (err) {
      await cloudSettings.updateUploadStatus(p.provider, 'failed', err.message);
      results.push({ provider: p.provider, ok: false, error: err.message });
      logger.warn('cloudBackup', `${p.provider} upload failed`, { fileName, error: err.message });
    }
  }

  return results;
}

/**
 * Test a provider's connection using a small dummy payload.
 * For telegram: sends a tiny text message.
 * For rclone: runs `rclone lsd` against the remote.
 * For r2: runs a HeadBucket check.
 */
async function testProvider(provider, config) {
  switch (provider) {
    case 'telegram': {
      const { chatId } = config;
      if (!chatId) throw new Error('chatId is required');
      await chatNotifier.sendTelegramMessage(
        String(chatId),
        '✅ Sarathi Bot cloud backup test — connection OK!'
      );
      return 'Test message sent to Telegram chat';
    }

    case 'rclone': {
      const rcloneStatus = checkRcloneInstalled();
      if (!rcloneStatus.installed) throw new Error('rclone is not installed');
      const remote     = String(config.remote || 'gdrive').trim();
      const remotePath = String(config.remotePath || 'SarathiBackups').trim();
      try {
        execFileSync('rclone', ['lsd', `${remote}:${remotePath}`], { timeout: 30_000, stdio: 'pipe' });
      } catch (err) {
        // If directory doesn't exist yet, mkdir is ok
        try {
          execFileSync('rclone', ['mkdir', `${remote}:${remotePath}`], { timeout: 30_000, stdio: 'pipe' });
        } catch (mkErr) {
          const stderr = mkErr.stderr ? mkErr.stderr.toString().trim() : mkErr.message;
          throw new Error(`rclone remote check failed: ${stderr}`);
        }
      }
      return `rclone remote "${remote}:${remotePath}" is accessible`;
    }

    case 'r2': {
      const { accountId, accessKeyId, secretAccessKey, bucketName } = config;
      if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
        throw new Error('All R2 fields are required');
      }
      let S3Client, HeadBucketCommand;
      try {
        ({ S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3'));
      } catch (_) {
        throw new Error('@aws-sdk/client-s3 is not installed. Run: npm install @aws-sdk/client-s3');
      }
      const client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      await client.send(new HeadBucketCommand({ Bucket: bucketName }));
      return `R2 bucket "${bucketName}" is accessible`;
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

module.exports = { uploadToCloud, testProvider, checkRcloneInstalled };
