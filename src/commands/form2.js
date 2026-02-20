/**
 * form2 command responsibility:
 * Entry point for the "form2" WhatsApp command handling.
 */

const fs = require('fs');
const { downloadForm } = require('../services/formService');

async function form2Command(client, message, MessageMedia) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await message.reply('Usage: form2 <application_number> <dob>');
    return;
  }

  await message.reply('Fetching form2 PDF...');

  try {
    const file = await downloadForm(appNo, dob, 'form2');
    const media = MessageMedia.fromFilePath(file);
    await client.sendMessage(message.from, media, { caption: 'Form 2' });

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await message.reply('Failed to fetch Form 2. Check application number and DOB format.');
  }
}

module.exports = form2Command;
