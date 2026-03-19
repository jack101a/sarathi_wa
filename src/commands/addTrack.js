const { addAutoTrack } = require('../services/autoTrackService');
const { isSarathiTrackedAnywhere } = require('../services/trackingControlService');

async function addTrackCommand(message, transport, chatId, appNo, tag, dob) {
  if (!appNo) {
    await message.reply('Usage: add track <application_number> [dob] -tag');
    return;
  }

  if (isSarathiTrackedAnywhere(appNo)) {
    await message.reply(`Application ${appNo} is already being tracked.`);
    return;
  }

  const result = addAutoTrack({
    appNo,
    transport,
    chatId,
    tag,
    dob,
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
