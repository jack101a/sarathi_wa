require('dotenv').config();

const assert = require('assert');
const { getTrackingSnapshot } = require('../src/services/trackingSnapshotService');
const { buildStatusCaption } = require('../src/services/autoTrackService');
const { closeBrowser } = require('../src/core/puppeteerEngine');

async function run() {
  const appNo = process.env.TEST_APP_NO;
  const dob = process.env.TEST_DOB;

  if (!appNo || !dob) {
    throw new Error('Set TEST_APP_NO and TEST_DOB in .env');
  }

  try {
    const snapshot = await getTrackingSnapshot(appNo, dob, {
      keepFile: false,
      filename: `Track_${appNo}_caption_test.jpg`,
    });
    const caption = buildStatusCaption(
      {
        appNo,
        tag: '',
      },
      snapshot
    );

    assert.ok(/Application No:\s*1118948626/i.test(caption), 'Missing application number.');
    assert.ok(/Name:\s*\*UDAY PARDULE\*/i.test(caption), 'Missing applicant name.');
    assert.ok(/Service Requested:\n1\. \*Renewal of DL\*/i.test(caption), 'Missing service requested.');
    assert.ok(/Current Status:\n\*PRINTING OF DL IN FORM 7\*/i.test(caption), 'Missing current status.');

    console.log('PASS - auto-track caption');
  } finally {
    await closeBrowser();
  }
}

run().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
