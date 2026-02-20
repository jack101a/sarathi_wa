/**
 * track command responsibility:
 * Entry point for the "track" WhatsApp command handling.
 */

const fs = require('fs');
const { getVisualStatus } = require('../services/statusService');

async function trackCommand(client, message, MessageMedia) {
  try {
    const parts = (message.body || '').trim().split(/\s+/);
    const appNo = parts[1];

    if (!appNo) {
      await message.reply('Usage: track <application_number>');
      return;
    }

    await message.reply('Fetching status...');
    const file = await getVisualStatus(appNo);
    const media = MessageMedia.fromFilePath(file);

    await client.sendMessage(message.from, media, { caption: 'Status' });

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await message.reply('Not Found');
  }
}

module.exports = trackCommand;
