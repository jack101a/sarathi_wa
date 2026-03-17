require('dotenv').config();

const assert = require('assert');
const { getTrackingSnapshot } = require('../src/services/trackingSnapshotService');
const { buildStatusCaption } = require('../src/services/autoTrackService');
const { closeBrowser } = require('../src/core/puppeteerEngine');

async function run() {
  try {
    const snapshot = await getTrackingSnapshot(process.env.TEST_APP_NO, process.env.TEST_DOB, {
      keepFile: false,
      filename: 'caption_format_test.jpg',
    });
    const caption = buildStatusCaption(
      {
        appNo: process.env.TEST_APP_NO,
        tag: '',
      },
      snapshot
    );

    assert.ok(/Application No: 1118948626/.test(caption), 'Missing application number.');
    assert.ok(/Name: \*UDAY PARDULE\*/.test(caption), 'Missing bold name.');
    assert.ok(/Service Requested:\n1\. \*Renewal of DL\*/.test(caption), 'Missing formatted service requested.');
    assert.ok(/Current Status:\n\*PRINTING OF DL IN FORM 7\*/.test(caption), 'Missing formatted current status.');

    console.log('PASS - track caption format');
  } finally {
    await closeBrowser();
  }
}

run().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
