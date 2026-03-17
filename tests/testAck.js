require('dotenv').config();

const fs = require('fs');
const CONFIG = require('../src/config/config');
const { getAckPDF } = require('../src/services/ackService');
const { closeBrowser } = require('../src/core/puppeteerEngine');

(async () => {
  let file;
  try {
    const appNo = process.env.TEST_APP_NO || '655728526';
    const dob = process.env.TEST_DOB || '15-06-1993';

    console.log('Testing ACK fetch...');
    console.log('ACK URL:', CONFIG.URLS.ACK);

    file = await getAckPDF(appNo, dob);
    console.log('Generated:', file);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (file && fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    await closeBrowser();
  }
})();
