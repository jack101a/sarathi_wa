const { removeAutoTrack } = require('../services/autoTrackService');

async function removeTrackCommand(message, transport, chatId, appNo) {
  if (!appNo) {
    await message.reply('Usage: remove track <application_number>');
    return;
  }

  const result = removeAutoTrack({
    appNo,
    transport,
    chatId,
  });

  if (result.removed) {
    await message.reply(`Auto-tracking removed for ${appNo}.`);
    return;
  }

  await message.reply(`No active auto-tracking entry found for ${appNo}.`);
}

module.exports = removeTrackCommand;
