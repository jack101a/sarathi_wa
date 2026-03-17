require('dotenv').config();

const fs = require('fs');
const { downloadForm } = require('../src/services/formService');
const { closeBrowser } = require('../src/core/puppeteerEngine');

async function test() {
  let file;
  try {
    const appNo = process.env.TEST_APP_NO;
    const dob = process.env.TEST_DOB;
    const form = process.env.TEST_FORM || 'form1';

    if (!appNo || !dob) {
      throw new Error('Set TEST_APP_NO and TEST_DOB in .env');
    }

    console.log(`Testing ${form}...`);

    file = await downloadForm(appNo, dob, form);

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
}

test();
