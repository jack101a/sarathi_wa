require('dotenv').config();

const fs = require('fs');
const CONFIG = require('../src/config/config');
const { getVisualStatus } = require('../src/services/statusService');
const { closeBrowser } = require('../src/core/puppeteerEngine');

(async () => {
  let file;
  try {
    const appNo = process.env.TEST_APP_NO || '655728526';

    console.log('Testing status fetch...');
    console.log('Status URL:', CONFIG.URLS.STATUS);

    file = await getVisualStatus(appNo);

    console.log('Generated file:', file);
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (file && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    await closeBrowser();
  }
})();
