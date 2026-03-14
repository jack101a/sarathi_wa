const { addAutoTrack } = require('../services/autoTrackService');

async function addTrackCommand(message, transport, chatId, appNo, tag) {
  if (!appNo) {
    await message.reply('Usage: add track <application_number> -tag');
    return;
  }

  const result = addAutoTrack({
    appNo,
    transport,
    chatId,
    tag,
  });

  if (result.created) {
    await message.reply(
      `Auto-tracking started for ${appNo}${tag ? ` - ${tag}` : ''}. I will notify you when it is approved.`
    );
    return;
  }

  await message.reply(`Application ${appNo} is already being tracked here.`);
}

module.exports = addTrackCommand;
