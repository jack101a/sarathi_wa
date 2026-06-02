const { subscriber } = require('@sarathi/common');
const { isInstanceActive } = require('./heartbeat');
const { MessageMedia } = require('whatsapp-web.js');

async function startResponseListener(client) {
  // Subscribe to both whatsapp and wa namespace patterns
  await subscriber.psubscribe('chat:response:whatsapp:*');
  await subscriber.psubscribe('chat:response:wa:*');

  subscriber.on('pmessage', async (pattern, channel, messageStr) => {
    try {
      // 1. Is this gateway instance currently active?
      const active = await isInstanceActive();
      if (!active) {
        // Ignore response delivery since we are in standby
        return;
      }

      // Channel is format: chat:response:whatsapp:1234567890@c.us or chat:response:wa:1234567890@c.us
      const parts = channel.split(':');
      const chatId = parts[3]; // The fourth element is the JID
      if (!chatId) {
        console.error(`[ResponseDelivery] Invalid channel name: ${channel}`);
        return;
      }

      const response = JSON.parse(messageStr);
      console.log(`[ResponseDelivery] Delivering response to ${chatId}: type=${response.type}`);

      if (response.type === 'text') {
        await client.sendMessage(chatId, response.text, response.options || {});
      } else if (response.type === 'media') {
        const media = new MessageMedia(
          response.mimeType,
          response.buffer, // base64 string
          response.filename
        );
        await client.sendMessage(chatId, media, { caption: response.caption || '' });
      } else {
        console.error(`[ResponseDelivery] Unsupported response type: ${response.type}`);
      }
    } catch (err) {
      console.error(`[ResponseDelivery] Error delivering response: ${err.message}`);
    }
  });

  console.log('[ResponseDelivery] Redis subscriber listening on chat:response:whatsapp:* and chat:response:wa:*');
}

module.exports = {
  startResponseListener
};
