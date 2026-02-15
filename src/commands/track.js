/**
 * track command responsibility:
 * Entry point for the "track" WhatsApp command handling.
 */

const fs = require('fs');
const { getVisualStatus } = require('../services/statusService');

async function trackCommand(client, message) {
  try {
    const parts = (message.body || '').split(/\s+/);
    const appNo = parts[1];

    if (!appNo) {
      await client.sendText(message.from, 'Usage: track <application_number>');
      return;
    }

    await client.sendText(message.from, 'Fetching status...');
    const file = await getVisualStatus(appNo);

    await client.sendImage(message.from, file, `Status_${appNo}.jpg`, 'Status');
    fs.unlinkSync(file);
  } catch (error) {
    await client.sendText(message.from, 'Not Found');
  }
}

module.exports = trackCommand;
