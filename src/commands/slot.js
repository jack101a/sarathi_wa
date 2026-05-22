/**
 * slot command responsibility:
 * Entry point for the "slot" WhatsApp command handling.
 */

const fs = require('fs');
const { getSlotAckPDF } = require('../services/ackService');

async function slotCommand(client, message, MessageMedia) {
  const parts = (message.body || '').trim().split(/\s+/);
  const appNo = parts[1];
  const dob = parts[2];

  if (!appNo || !dob) {
    await message.reply('Usage: slot <appl_no> <DOB>');
    return;
  }

  await message.reply('Fetching slot booking acknowledgement PDF...');

  try {
    const file = await getSlotAckPDF(appNo, dob);
    const media = MessageMedia.fromFilePath(file);
    await client.sendMessage(message.from, media, { caption: 'Slot Acknowledgement' });

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (error) {
    await message.reply('Failed to fetch slot acknowledgement PDF. Check DOB or application number.');
  }
}

module.exports = slotCommand;
