/**
 * form1a command responsibility:
 * Entry point for the "form1a" WhatsApp command handling.
 */

const fs = require('fs');
const { downloadForm } = require('../services/formService');

async function form1aCommand(client, message) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await client.sendText(message.from, 'Usage: form1a <application_number> <dob>');
    return;
  }

  await client.sendText(message.from, 'Fetching form1a PDF...');

  try {
    const file = await downloadForm(appNo, dob, 'form1a');
    await client.sendFile(message.from, file, `form1a_${appNo}.pdf`, 'Form 1A');

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await client.sendText(
      message.from,
      'Failed to fetch Form 1A. Check application number and DOB format.'
    );
  }
}

module.exports = form1aCommand;
