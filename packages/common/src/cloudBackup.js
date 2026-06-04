'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const cloudBackupSettings = require('./cloudBackupSettings');
const chatNotifier = require('./chatNotifier');
const logger = require('./logger');

function checkRcloneInstalled() {
  try {
    execFileSync('rclone', ['version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function uploadTelegram(filePath, fileName, provider) {
  const chatIds = Array.isArray(provider.config.chatIds) ? provider.config.chatIds.filter(Boolean) : [];
  if (chatIds.length === 0) throw new Error('Telegram cloud backup requires at least one chat id');

  const buffer = fs.readFileSync(filePath);
  for (const chatId of chatIds) {
    await chatNotifier.sendTelegramDocument(
      chatId,
      buffer,
      fileName,
      `Database backup: ${fileName}`,
      'application/octet-stream'
    );
  }
}

async function uploadRclone(filePath, fileName, provider) {
  const remote = String(provider.config.remote || '').trim();
  const remotePath = String(provider.config.path || 'sarathiwa-backups').replace(/^\/+|\/+$/g, '');
  if (!remote) throw new Error('Rclone cloud backup requires a remote name');
  if (!checkRcloneInstalled()) throw new Error('rclone binary is not installed in this container');

  const destination = remotePath ? `${remote}:${remotePath}/${fileName}` : `${remote}:${fileName}`;
  execFileSync('rclone', ['copyto', filePath, destination], { stdio: 'pipe', timeout: 5 * 60 * 1000 });
}

async function uploadR2(filePath, fileName, provider) {
  const { endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto' } = provider.config;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 cloud backup requires endpoint, bucket, access key, and secret key');
  }

  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true
  });

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `sarathiwa-backups/${fileName}`,
    Body: fs.createReadStream(filePath),
    ContentType: 'application/octet-stream'
  }));
}

async function uploadToProvider(providerName, filePath, fileName) {
  const provider = await cloudBackupSettings.getProvider(providerName);
  if (!provider.enabled) return { provider: providerName, skipped: true, reason: 'disabled' };

  try {
    if (providerName === 'telegram') await uploadTelegram(filePath, fileName, provider);
    if (providerName === 'rclone') await uploadRclone(filePath, fileName, provider);
    if (providerName === 'r2') await uploadR2(filePath, fileName, provider);

    await cloudBackupSettings.recordUploadStatus(providerName, 'success', '');
    logger.info('cloudBackup', 'Cloud backup upload succeeded', { provider: providerName, fileName });
    return { provider: providerName, ok: true };
  } catch (err) {
    await cloudBackupSettings.recordUploadStatus(providerName, 'failed', err.message);
    logger.error('cloudBackup', 'Cloud backup upload failed', { provider: providerName, fileName, error: err.message });
    return { provider: providerName, ok: false, error: err.message };
  }
}

async function uploadToCloud(filePath, fileName) {
  if (!fs.existsSync(filePath)) throw new Error(`Backup file not found: ${fileName}`);

  const providers = await cloudBackupSettings.getAllProviders(true);
  const enabledProviders = Object.values(providers).filter((provider) => provider.enabled);
  if (enabledProviders.length === 0) {
    return { ok: false, message: 'No cloud backup providers are enabled', results: [] };
  }

  const results = [];
  for (const provider of enabledProviders) {
    results.push(await uploadToProvider(provider.provider, filePath, fileName));
  }

  return { ok: results.some((result) => result.ok), results };
}

async function testProvider(providerName) {
  const provider = await cloudBackupSettings.getProvider(providerName);
  if (providerName === 'telegram') {
    const chatIds = Array.isArray(provider.config.chatIds) ? provider.config.chatIds.filter(Boolean) : [];
    if (chatIds.length === 0) throw new Error('Telegram provider has no chat ids configured');
    await chatNotifier.sendTelegramMessage(chatIds[0], 'SarathiWA cloud backup test message');
    return { ok: true, message: 'Telegram test message queued' };
  }

  if (providerName === 'rclone') {
    if (!checkRcloneInstalled()) throw new Error('rclone binary is not installed in this container');
    execFileSync('rclone', ['lsd', `${provider.config.remote}:`], { stdio: 'pipe', timeout: 30000 });
    return { ok: true, message: 'Rclone remote is reachable' };
  }

  if (providerName === 'r2') {
    const tmp = Buffer.from('sarathiwa cloud backup test\n');
    const key = `sarathiwa-backups/test-${Date.now()}.txt`;
    const { endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto' } = provider.config;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 provider is missing required configuration');
    }
    const client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true
    });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: tmp, ContentType: 'text/plain' }));
    return { ok: true, message: 'R2 test upload succeeded' };
  }

  throw new Error(`Unsupported cloud backup provider: ${providerName}`);
}

module.exports = {
  checkRcloneInstalled,
  uploadToCloud,
  testProvider
};
