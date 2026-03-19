const fs = require('fs');
const path = require('path');
const CONFIG = require('../config/config');

function ensureTempDir() {
  const tempDir = CONFIG.TEMP.DIR;
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  return tempDir;
}

function getTempFilePath(filename) {
  return path.join(ensureTempDir(), String(filename || '').trim());
}

module.exports = {
  ensureTempDir,
  getTempFilePath,
};
