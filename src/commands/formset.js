const { MessageMedia } = require('whatsapp-web.js');
const { getFormset } = require('../services/formsetService');

async function formsetCommand(client, message) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await message.reply('Usage: formset <appl_no> <DOB>');
    return;
  }

  await message.reply('Building formset PDF...');

  try {
    const { buffer, filename } = await getFormset(appNo, dob);
    const media = new MessageMedia('application/pdf', buffer.toString('base64'), filename);

    await client.sendMessage(message.from, media, {
      caption: 'Formset PDF',
      sendMediaAsDocument: true,
    });
  } catch (error) {
    await message.reply('Failed to build formset PDF. Check the application number and DOB.');
  }
}

module.exports = formsetCommand;
