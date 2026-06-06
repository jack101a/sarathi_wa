const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarathi-rclone-'));
const configPath = path.join(tempDir, 'rclone.conf');

process.env.RCLONE_CONFIG = configPath;

const cloudBackup = require('../packages/common/src/cloudBackup');

try {
  assert.strictEqual(cloudBackup.getRcloneConfigPath(), configPath);
  assert.strictEqual(cloudBackup.getRcloneConfigStatus().exists, false);

  assert.throws(
    () => cloudBackup.writeRcloneConfig(''),
    /empty/
  );

  assert.throws(
    () => cloudBackup.writeRcloneConfig('type = drive\n'),
    /remote section/
  );

  const status = cloudBackup.writeRcloneConfig(`
[gdrive]
type = drive
scope = drive
token = {"access_token":"secret"}
`);

  assert.strictEqual(status.exists, true);
  assert.strictEqual(status.path, configPath);
  const saved = fs.readFileSync(configPath, 'utf8');
  assert.match(saved, /^\[gdrive\]/m);
  assert.match(saved, /^type = drive$/m);

  const mode = fs.statSync(configPath).mode & 0o777;
  assert.strictEqual(mode, 0o600);

  console.log('Rclone config tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
