/**
 * track command responsibility:
 * Entry point for the "track" WhatsApp command handling.
 */

const fs = require('fs');
const { getTrackingSnapshot } = require('../services/trackingSnapshotService');
const { buildStatusCaption } = require('../services/autoTrackService');

async function trackCommand(client, message, MessageMedia, request = {}) {
  try {
    const parts = (message.body || '').trim().split(/\s+/);
    const appNo = request.appNo || parts[1];
    const dob = request.dob || parts[2];

    if (!appNo) {
      await message.reply('Usage: track <application_number> [dob]');
      return;
    }

    await message.reply('Fetching status...');
    const snapshot = await getTrackingSnapshot(appNo, dob, {
      keepFile: true,
      filename: `Track_${appNo}.jpg`,
    });
    const file = snapshot.filePath;
    const media = MessageMedia.fromFilePath(file);
    const caption = buildStatusCaption(
      {
        appNo,
        tag: '',
      },
      snapshot
    );

    await client.sendMessage(message.from, media, { caption });

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await message.reply('Not Found');
  }
}

module.exports = trackCommand;
