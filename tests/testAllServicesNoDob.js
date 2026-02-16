require('dotenv').config();

const { getVisualStatus } = require('../src/services/statusService');
const { downloadForm } = require('../src/services/formService');
const { getAckPDF } = require('../src/services/ackService');

async function run() {
  const appNo = String(process.env.TEST_APP_NO || '').trim();
  const formName = String(process.env.TEST_FORM || 'form1').trim();

  if (!appNo) {
    throw new Error('Set TEST_APP_NO in .env');
  }

  console.log('Running all service tests with APP NO only (no DOB).');
  console.log(`APP NO: ${appNo}`);
  console.log(`FORM: ${formName}`);
  console.log('');

  const results = [];

  try {
    const file = await getVisualStatus(appNo);
    results.push({ service: 'statusService.getVisualStatus', ok: true, detail: file });
  } catch (err) {
    results.push({
      service: 'statusService.getVisualStatus',
      ok: false,
      detail: err.message,
    });
  }

  try {
    await downloadForm(appNo, '', formName);
    results.push({
      service: 'formService.downloadForm',
      ok: false,
      detail: 'Expected DOB validation error, but call succeeded.',
    });
  } catch (err) {
    const expected = /DOB is required/i.test(String(err.message || ''));
    results.push({
      service: 'formService.downloadForm',
      ok: expected,
      detail: expected ? 'Expected DOB validation error received.' : err.message,
    });
  }

  try {
    await getAckPDF(appNo, '');
    results.push({
      service: 'ackService.getAckPDF',
      ok: false,
      detail: 'Expected DOB validation error, but call succeeded.',
    });
  } catch (err) {
    const expected = /DOB is required/i.test(String(err.message || ''));
    results.push({
      service: 'ackService.getAckPDF',
      ok: expected,
      detail: expected ? 'Expected DOB validation error received.' : err.message,
    });
  }

  console.log('Results:');
  for (const item of results) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} - ${item.service} -> ${item.detail}`);
  }

  const failed = results.filter((x) => !x.ok);
  if (failed.length) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
