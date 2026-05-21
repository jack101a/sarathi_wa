/**
 * form1 command responsibility:
 * Entry point for the "form1" WhatsApp command handling.
 */

const fs = require('fs');
const { downloadForm } = require('../services/formService');

async function form1Command(client, message, MessageMedia) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await message.reply('Usage: form1 <appl_no> <DOB>');
    return;
  }

  await message.reply('Fetching form1 PDF...');

  try {
    const file = await downloadForm(appNo, dob, 'form1');
    const media = MessageMedia.fromFilePath(file);
    await client.sendMessage(message.from, media, { caption: 'Form 1' });

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await message.reply('Failed to fetch Form 1. Check application number and DOB format.');
  }
}

module.exports = form1Command;
