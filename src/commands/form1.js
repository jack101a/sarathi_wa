/**
 * form1 command responsibility:
 * Entry point for the "form1" WhatsApp command handling.
 */

const fs = require('fs');
const { downloadForm } = require('../services/formService');

async function form1Command(client, message) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await client.sendText(message.from, 'Usage: form1 <application_number> <dob>');
    return;
  }

  await client.sendText(message.from, 'Fetching form1 PDF...');

  try {
    const file = await downloadForm(appNo, dob, 'form1');
    await client.sendFile(message.from, file, `form1_${appNo}.pdf`, 'Form 1');

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await client.sendText(
      message.from,
      'Failed to fetch Form 1. Check application number and DOB format.'
    );
  }
}

module.exports = form1Command;
