/**
 * appl command responsibility:
 * Entry point for the "appl" WhatsApp command handling.
 */

const fs = require('fs');
const { getAckPDF } = require('../services/ackService');

async function applCommand(client, message, MessageMedia) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await message.reply('Usage: appl <application_number> <dob>');
    return;
  }

  await message.reply('Fetching receipt...');

  try {
    const file = await getAckPDF(appNo, dob);
    const media = MessageMedia.fromFilePath(file);
    await client.sendMessage(message.from, media, { caption: 'Receipt' });

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await message.reply('Failed to fetch receipt. Check DOB or application number.');
  }
}

module.exports = applCommand;
