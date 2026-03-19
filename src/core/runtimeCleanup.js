const fs = require('fs');
const path = require('path');

const LOCK_PATTERNS = [
  /^Singleton/i,
  /^LOCK$/i,
  /\.lock$/i,
];

function shouldDeleteLockFile(fileName) {
  return LOCK_PATTERNS.some((pattern) => pattern.test(String(fileName || '').trim()));
}

function walkFiles(rootDir, collected = []) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return collected;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, collected);
      continue;
    }

    collected.push(fullPath);
  }

  return collected;
}

function cleanupWhatsAppAuthLocks(authDir = path.join(process.cwd(), '.wwebjs_auth')) {
  const files = walkFiles(authDir);
  const deleted = [];

  for (const filePath of files) {
    if (!shouldDeleteLockFile(path.basename(filePath))) {
      continue;
    }

    try {
      fs.rmSync(filePath, { force: true });
      deleted.push(filePath);
    } catch (error) {
      console.warn(`[startup] Failed to delete lock file ${filePath}: ${error.message}`);
    }
  }

  return deleted;
}

module.exports = {
  cleanupWhatsAppAuthLocks,
};
