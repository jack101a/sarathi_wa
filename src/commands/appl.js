/**
 * appl command responsibility:
 * Entry point for the "appl" WhatsApp command handling.
 */

const fs = require('fs');
const { getAckPDF } = require('../services/ackService');

async function applCommand(client, message) {
  const parts = (message.body || '').split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await client.sendText(message.from, 'Usage: appl <application_number> <dob>');
    return;
  }

  await client.sendText(message.from, 'Fetching receipt...');

  try {
    const file = await getAckPDF(appNo, dob);
    await client.sendFile(message.from, file, `Ack_${appNo}.pdf`, 'Receipt');
    fs.unlinkSync(file);
  } catch (error) {
    await client.sendText(
      message.from,
      'Failed to fetch receipt. Check DOB or application number.'
    );
  }
}

module.exports = applCommand;
