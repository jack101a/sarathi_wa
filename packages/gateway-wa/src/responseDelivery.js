const { subscriber, redis } = require('@sarathi/common');
const { MessageMedia } = require('whatsapp-web.js');
const crypto = require('crypto');

async function startResponseListener(client) {
  // Subscribe to both whatsapp and wa namespace patterns
  await subscriber.psubscribe('chat:response:whatsapp:*');
  await subscriber.psubscribe('chat:response:wa:*');

  subscriber.on('pmessage', async (pattern, channel, messageStr) => {
    try {
      // ── Response dedup ─────────────────────────────────────────────────────
      // All gateway-wa instances subscribe to the same channel.
      // Only the FIRST instance to claim this delivery key actually sends it.
      const msgHash = crypto.createHash('md5').update(messageStr).digest('hex');
      const deliveryKey = `dedup:resp:${channel}:${msgHash}`;
      const claimed = await redis.set(deliveryKey, process.env.INSTANCE_ID || '1', 'EX', 60, 'NX');
      if (!claimed) {
        // Another gateway-wa instance already sent this response — skip
        return;
      }

      // Channel is format: chat:response:whatsapp:1234567890@c.us
      const parts = channel.split(':');
      const chatId = parts[3]; // The fourth element is the JID
      if (!chatId) {
        console.error(`[ResponseDelivery] Invalid channel name: ${channel}`);
        return;
      }

      const response = JSON.parse(messageStr);
      console.log(`[ResponseDelivery][${process.env.INSTANCE_ID || 'wa'}] Delivering to ${chatId}: type=${response.type}`);

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
