/**
 * form1a command responsibility:
 * Entry point for the "form1a" WhatsApp command handling.
 */

const fs = require('fs');
const { downloadForm } = require('../services/formService');

async function form1aCommand(client, message, MessageMedia) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await message.reply('Usage: form1a <appl_no> <DOB>');
    return;
  }

  await message.reply('Fetching form1a PDF...');

  try {
    const file = await downloadForm(appNo, dob, 'form1a');
    const media = MessageMedia.fromFilePath(file);
    await client.sendMessage(message.from, media, { caption: 'Form 1A' });

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await message.reply('Failed to fetch Form 1A. Check application number and DOB format.');
  }
}

module.exports = form1aCommand;
