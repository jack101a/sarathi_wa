const { getRandomAliveMeme } = require('../services/aliveService');

async function aliveCommand(client, message, MessageMedia) {
  try {
    const meme = getRandomAliveMeme();
    const media = await MessageMedia.fromUrl(meme.url, {
      unsafeMime: true,
      filename: 'alive.mp4',
    });

    await client.sendMessage(message.from, media, {
      caption: meme.caption,
      sendVideoAsGif: true,
    });
  } catch (error) {
    await message.reply('Bot is alive, but the meme could not be loaded right now.');
  }
}

module.exports = aliveCommand;
