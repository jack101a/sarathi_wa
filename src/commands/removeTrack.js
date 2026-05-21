const { removeSarathiTrackEverywhere } = require('../services/trackingControlService');

async function removeTrackCommand(message, transport, chatId, appNo) {
  if (!appNo) {
    await message.reply('Usage: remove track <appl_no>');
    return;
  }

  const result = removeSarathiTrackEverywhere(appNo);

  if (result.removed) {
    await message.reply(`Auto-tracking removed for ${appNo}.`);
    return;
  }

  await message.reply(`No active auto-tracking entry found for ${appNo}.`);
}

module.exports = removeTrackCommand;
