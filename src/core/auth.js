/**
 * Authorization helper for WhatsApp and Telegram bots.
 * 
 * This module provides bouncer functions that prevent unauthorized users
 * and groups from interacting with the bots.
 */

/**
 * WhatsApp Bouncer
 * Why: Prevents random people from spamming the WA bot.
 * 
 * @param {Object} message - WhatsApp message object
 * @param {Object} config - Configuration object with SECURITY settings
 * @returns {boolean} True if the sender is authorized, false otherwise
 */
function isAuthorized(message, config) {
  try {
    const senderId = message.from;
    
    // Check if it's a group message
    if (senderId.endsWith('@g.us')) {
      return config.SECURITY.AUTHORIZED_GROUPS.includes(senderId);
    }
    
    // Check if it's a private message (remove @c.us suffix for comparison)
    if (senderId.endsWith('@c.us')) {
      return config.SECURITY.AUTHORIZED_USERS.includes(senderId.replace('@c.us', ''));
    }
    
    return false;
  } catch (error) {
    console.error("WA Auth check failed:", error);
    return false;
  }
}

/**
 * Telegram Bouncer
 * Why: Prevents random people from spamming the TG bot.
 * 
 * @param {Object} msg - Telegram message object
 * @param {Object} config - Configuration object with SECURITY settings
 * @returns {boolean} True if the chat is authorized, false otherwise
 */
function isTgAuthorized(msg, config) {
  try {
    const chatId = msg.chat.id.toString(); // TG IDs are numbers, convert to string for strict matching
    const chatType = msg.chat.type;

    // Private chats: check AUTHORIZED_TG_USERS
    if (chatType === 'private') {
      return config.SECURITY.AUTHORIZED_TG_USERS.includes(chatId);
    }
    
    // Groups or supergroups: check AUTHORIZED_TG_GROUPS
    if (chatType === 'group' || chatType === 'supergroup') {
      return config.SECURITY.AUTHORIZED_TG_GROUPS.includes(chatId);
    }
    
    return false;
  } catch (error) {
    console.error("TG Auth check failed:", error);
    return false;
  }
}

module.exports = { isAuthorized, isTgAuthorized };
