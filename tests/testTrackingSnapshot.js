require('dotenv').config();

const assert = require('assert');
const fs = require('fs');
const { getTrackingSnapshot } = require('../src/services/trackingSnapshotService');
const { closeBrowser } = require('../src/core/puppeteerEngine');

async function run() {
  const appNo = process.env.TEST_APP_NO;
  const dob = process.env.TEST_DOB;
  let outputPath = null;
  let statusOnlyPath = null;

  if (!appNo || !dob) {
    throw new Error('Set TEST_APP_NO and TEST_DOB in .env');
  }

  try {
    console.log('Testing merged tracking snapshot...');
    const statusOnlySnapshot = await getTrackingSnapshot(appNo, '', {
      keepFile: true,
      filename: `Track_${appNo}_status_only_test.jpg`,
    });
    statusOnlyPath = statusOnlySnapshot.filePath;

    if (statusOnlySnapshot.mode !== 'status-only') {
      throw new Error(`Expected status-only mode, got ${statusOnlySnapshot.mode}`);
    }
    assert.ok(statusOnlySnapshot.buffer && statusOnlySnapshot.buffer.length > 0, 'Status-only buffer is empty.');
    assert.ok(fs.existsSync(statusOnlyPath), 'Status-only snapshot file was not kept.');

    const snapshot = await getTrackingSnapshot(appNo, dob, {
      keepFile: true,
      filename: `Track_${appNo}_test.jpg`,
    });

    outputPath = snapshot.filePath;

    if (!snapshot.buffer || !snapshot.buffer.length) {
      throw new Error('Snapshot buffer is empty.');
    }
    assert.ok(fs.existsSync(outputPath), 'Merged snapshot file was not kept.');

    console.log(`Mode: ${snapshot.mode}`);
    console.log(`File: ${snapshot.filePath}`);
  } finally {
    if (statusOnlyPath && fs.existsSync(statusOnlyPath)) {
      fs.unlinkSync(statusOnlyPath);
    }
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    await closeBrowser();
  }
}

run().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
