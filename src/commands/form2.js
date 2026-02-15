/**
 * form2 command responsibility:
 * Entry point for the "form2" WhatsApp command handling.
 */

const fs = require('fs');
const { downloadForm } = require('../services/formService');

async function form2Command(client, message) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await client.sendText(message.from, 'Usage: form2 <application_number> <dob>');
    return;
  }

  await client.sendText(message.from, 'Fetching form2 PDF...');

  try {
    const file = await downloadForm(appNo, dob, 'form2');
    await client.sendFile(message.from, file, `form2_${appNo}.pdf`, 'Form 2');

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await client.sendText(
      message.from,
      'Failed to fetch Form 2. Check application number and DOB format.'
    );
  }
}

module.exports = form2Command;
