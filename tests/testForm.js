require('dotenv').config();

const { downloadForm } = require('../src/services/formService');

async function test() {
  try {
    const appNo = process.env.TEST_APP_NO;
    const dob = process.env.TEST_DOB;
    const form = process.env.TEST_FORM || 'form1';

    if (!appNo || !dob) {
      throw new Error('Set TEST_APP_NO and TEST_DOB in .env');
    }

    console.log(`Testing ${form}...`);

    const file = await downloadForm(appNo, dob, form);

    console.log('Generated:', file);
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

test();