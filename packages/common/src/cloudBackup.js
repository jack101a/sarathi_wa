'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const cloudBackupSettings = require('./cloudBackupSettings');
const logger = require('./logger');

const RCLONE_CONFIG_MAX_BYTES = Number(process.env.RCLONE_CONFIG_MAX_BYTES || 256 * 1024);

function getRcloneConfigPath() {
  if (process.env.RCLONE_CONFIG) return process.env.RCLONE_CONFIG;
  return path.join(process.env.HOME || '/root', '.config', 'rclone', 'rclone.conf');
}

function checkRcloneInstalled() {
  try {
    execFileSync('rclone', ['version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

function getRcloneConfigStatus() {
  const configPath = getRcloneConfigPath();
  try {
    const stat = fs.statSync(configPath);
    return {
      path: configPath,
      exists: true,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch (_) {
    return {
      path: configPath,
      exists: false,
      sizeBytes: 0,
      updatedAt: null,
    };
  }
}

function validateRcloneConfigContents(contents) {
  const text = String(contents || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error('rclone.conf content is empty');
  if (Buffer.byteLength(text, 'utf8') > RCLONE_CONFIG_MAX_BYTES) {
    throw new Error(`rclone.conf is too large. Maximum size is ${Math.floor(RCLONE_CONFIG_MAX_BYTES / 1024)} KB`);
  }
  if (text.includes('\0')) throw new Error('rclone.conf contains invalid null bytes');
  if (!/^\s*\[[^\]\r\n]+\]\s*$/m.test(text)) {
    throw new Error('rclone.conf must contain at least one remote section like [gdrive]');
  }
  if (!/^\s*type\s*=/m.test(text)) {
    throw new Error('rclone.conf must contain a remote type entry');
  }
  return `${text}\n`;
}

function writeRcloneConfig(contents) {
  const normalized = validateRcloneConfigContents(contents);
  const configPath = getRcloneConfigPath();
  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tempPath, normalized, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tempPath, configPath);
    try { fs.chmodSync(configPath, 0o600); } catch (_) {}
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw err;
  }

  logger.info('cloudBackup', 'rclone config file updated', { path: configPath });
  return getRcloneConfigStatus();
}

async function uploadTelegram(filePath, fileName, provider) {
  const chatIds = Array.isArray(provider.config.chatIds) ? provider.config.chatIds.filter(Boolean) : [];
  if (chatIds.length === 0) throw new Error('Telegram cloud backup requires at least one chat id');

  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TG_TOKEN || '';
  if (!token) throw new Error('Telegram cloud backup requires TELEGRAM_BOT_TOKEN');

  const buffer = fs.readFileSync(filePath);
  for (const chatId of chatIds) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', `Database backup: ${fileName}`);
    form.set('document', new Blob([buffer], { type: 'application/octet-stream' }), fileName);
    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.description || `Telegram upload failed with HTTP ${response.status}`);
    }
  }
  return `Delivered to ${chatIds.length} Telegram chat(s)`;
}

async function uploadRclone(filePath, fileName, provider) {
  const remote = String(provider.config.remote || '').trim();
  const remotePath = String(provider.config.path || 'sarathiwa-backups').replace(/^\/+|\/+$/g, '');
  if (!remote) throw new Error('Rclone cloud backup requires a remote name');
  if (!checkRcloneInstalled()) throw new Error('rclone binary is not installed in this container');

  const destination = remotePath ? `${remote}:${remotePath}/${fileName}` : `${remote}:${fileName}`;
  execFileSync('rclone', ['copyto', filePath, destination], { stdio: 'pipe', timeout: 5 * 60 * 1000 });
  return `Uploaded to ${destination}`;
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
  return `Uploaded to ${bucket}/sarathiwa-backups/${fileName}`;
}

async function uploadToProvider(providerName, filePath, fileName) {
  const provider = await cloudBackupSettings.getProvider(providerName);
  if (!provider.enabled) return { provider: providerName, skipped: true, reason: 'disabled' };

  try {
    let result = '';
    if (providerName === 'telegram') result = await uploadTelegram(filePath, fileName, provider);
    if (providerName === 'rclone') result = await uploadRclone(filePath, fileName, provider);
    if (providerName === 'r2') result = await uploadR2(filePath, fileName, provider);

    await cloudBackupSettings.recordUploadStatus(providerName, 'success', '');
    logger.info('cloudBackup', 'Cloud backup upload succeeded', { provider: providerName, fileName });
    return { provider: providerName, ok: true, result };
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

async function testProvider(providerName, configOverride = null) {
  const provider = await cloudBackupSettings.getProvider(providerName);
  if (configOverride && typeof configOverride === 'object') {
    provider.config = { ...(provider.config || {}), ...configOverride };
  }
  if (providerName === 'telegram') {
    const chatIds = Array.isArray(provider.config.chatIds) ? provider.config.chatIds.filter(Boolean) : [];
    if (chatIds.length === 0) throw new Error('Telegram provider has no chat ids configured');
    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TG_TOKEN || '';
    if (!token) throw new Error('Telegram provider requires TELEGRAM_BOT_TOKEN');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatIds[0]),
        text: 'SarathiWA cloud backup test message',
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.description || `Telegram test failed with HTTP ${response.status}`);
    }
    return { ok: true, message: 'Telegram test message delivered' };
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
  getRcloneConfigPath,
  getRcloneConfigStatus,
  writeRcloneConfig,
  uploadToCloud,
  testProvider
};
