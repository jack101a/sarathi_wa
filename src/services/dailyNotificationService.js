const cron = require('node-cron');
const fs = require('fs');
const { getAllTrackedItems } = require('./trackingControlService');
const { generateStatusImage } = require('./imageGeneratorService');
const { sendWhatsAppImage, sendTelegramPhoto } = require('./chatNotifier');

async function sendDailyReports() {
  const { sarathiTracked, vahanTracked } = getAllTrackedItems();
  const allUsers = new Set();
  
  sarathiTracked.forEach(item => {
    if (item.chatId && item.transport) {
      allUsers.add(JSON.stringify({ chatId: item.chatId, transport: item.transport }));
    }
  });
  
  vahanTracked.forEach(item => {
    if (item.chatId && item.transport) {
      allUsers.add(JSON.stringify({ chatId: item.chatId, transport: item.transport }));
    }
  });
  
  for (const userJson of allUsers) {
    const user = JSON.parse(userJson);
    try {
      const imagePath = await generateStatusImage(user.chatId);
      const buffer = fs.readFileSync(imagePath);
      const filename = `daily_status_${user.chatId}.png`;
      const caption = 'Daily Application Status Report (8 PM)';
      
      if (user.transport === 'whatsapp') {
        await sendWhatsAppImage(user.chatId, buffer, filename, caption);
      } else if (user.transport === 'telegram') {
        await sendTelegramPhoto(user.chatId, buffer, filename, caption);
      }
      
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    } catch (error) {
      console.error(`Failed to send daily report to ${user.chatId}:`, error);
    }
  }
}

function startDailyNotificationScheduler() {
  // 8 PM daily: 0 20 * * *
  console.log('Daily notification scheduler started (8 PM).');
  return cron.schedule('0 20 * * *', () => {
    console.log('Running daily 8 PM status report broadcast...');
    sendDailyReports().catch(err => console.error('Daily notification scheduler error:', err));
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
}

module.exports = {
  startDailyNotificationScheduler,
  sendDailyReports
};
