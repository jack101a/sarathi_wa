require('dotenv').config();

const assert = require('assert');
const fs = require('fs');
const CONFIG = require('../src/config/config');
const {
  addAutoTrack,
  refreshTrackedApplications,
  removeAutoTrack,
} = require('../src/services/autoTrackService');
const { setWhatsAppClient } = require('../src/services/chatNotifier');
const { closeBrowser } = require('../src/core/puppeteerEngine');

async function run() {
  const appNo = process.env.TEST_APP_NO;
  const dob = process.env.TEST_DOB;
  const chatId = 'test-refresh-chat';
  const storePath = CONFIG.AUTO_TRACK.STORE_PATH;
  const backupPath = `${storePath}.bak_test`;
  const sent = [];

  if (!appNo || !dob) {
    throw new Error('Set TEST_APP_NO and TEST_DOB in .env');
  }

  try {
    if (fs.existsSync(storePath)) {
      fs.copyFileSync(storePath, backupPath);
    }

    fs.mkdirSync(require('path').dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, '[]');

    setWhatsAppClient({
      sendMessage: async (...args) => {
        sent.push(args);
      },
    });

    addAutoTrack({
      appNo,
      chatId,
      transport: 'whatsapp',
      dob,
      tag: 'Refresh Test',
    });

    const count = await refreshTrackedApplications(chatId);
    assert.strictEqual(count, 1, 'Expected one tracked application to refresh.');
    assert.ok(sent.length >= 1, 'Expected at least one WhatsApp refresh message.');
    assert.ok(/Name:\s*\*UDAY PARDULE\*/i.test(sent[0][2].caption), 'Missing applicant name in refresh caption.');
    assert.ok(/Service Requested:\n1\. \*Renewal of DL\*/i.test(sent[0][2].caption), 'Missing service requested in refresh caption.');
    assert.ok(/Current Status:\n\*PRINTING OF DL IN FORM 7\*/i.test(sent[0][2].caption), 'Missing current status in refresh caption.');

    console.log('PASS - refresh track queue');
  } finally {
    removeAutoTrack({
      appNo,
      chatId,
      transport: 'whatsapp',
    });

    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, storePath);
      fs.unlinkSync(backupPath);
    } else if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
    }

    await closeBrowser();
  }
}

run().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
