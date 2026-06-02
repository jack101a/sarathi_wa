'use strict';
/**
 * gateway-tg — Telegram Gateway Entry Point
 *
 * Starts the Telegram bot, subscribes to the Redis response channel,
 * and routes responses from browser/API workers back to the user.
 *
 * Response flow:
 *   Worker publishes to: chat:response:telegram:{chatId}
 *   This gateway receives it and calls bot.sendMessage / bot.sendDocument
 */

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const Redis = require('ioredis');
const { config: CONFIG, logger, chatNotifier } = require('@sarathi/common');
const { handleIncomingMessage } = require('./messageHandler');

const TG_TOKEN = process.env.TG_TOKEN || (CONFIG.TELEGRAM && CONFIG.TELEGRAM.TOKEN) || null;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

if (!TG_TOKEN) {
  console.warn('[gateway-tg] TG_TOKEN not set — Telegram bot will not start.');
  process.exit(0);
}

async function main() {
  logger.info('gateway-tg', 'Starting Telegram Gateway...');

  // ── Telegram Bot Client ────────────────────────────────────────────────────
  const bot = new TelegramBot(TG_TOKEN, { polling: true });

  // Register the chatNotifier Telegram bot instance for sending responses
  if (chatNotifier.setTelegramBot) {
    chatNotifier.setTelegramBot(bot);
  }

  bot.on('polling_error', (err) => {
    logger.error('gateway-tg', `Polling error: ${err.message}`);
  });

  bot.on('message', async (msg) => {
    await handleIncomingMessage(bot, msg);
  });

  logger.info('gateway-tg', 'Telegram bot polling started.');

  // ── Redis Response Delivery (Workers → Gateway → User) ────────────────────
  //
  // Workers publish results to:  chat:response:telegram:{chatId}
  // Message payload: JSON string of { type, text, filePath, mimeType, filename, caption }
  //
  const subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  await subscriber.psubscribe('chat:response:telegram:*');

  subscriber.on('pmessage', async (_pattern, channel, message) => {
    // channel = 'chat:response:telegram:123456789'
    const chatId = channel.replace('chat:response:telegram:', '');
    try {
      const payload = JSON.parse(message);

      if (payload.type === 'text') {
        await bot.sendMessage(chatId, payload.text || '');
      } else if (payload.type === 'photo') {
        const buf = Buffer.from(payload.buffer, 'base64');
        await bot.sendPhoto(chatId, buf, { caption: payload.caption || '' });
      } else if (payload.type === 'document') {
        const buf = Buffer.from(payload.buffer, 'base64');
        await bot.sendDocument(chatId, buf, { caption: payload.caption || '' }, { filename: payload.filename || 'document' });
      } else if (payload.text) {
        // Fallback: if there's a text field, send it
        await bot.sendMessage(chatId, payload.text);
      }
    } catch (err) {
      logger.error('gateway-tg', `Response delivery failed for chatId=${chatId}: ${err.message}`);
    }
  });

  subscriber.on('error', (err) => {
    logger.error('gateway-tg', `Redis subscriber error: ${err.message}`);
  });

  logger.info('gateway-tg', 'Redis response delivery listener started on chat:response:telegram:*');

  // ── Graceful Shutdown ──────────────────────────────────────────────────────
  const handleShutdown = async (signal) => {
    logger.info('gateway-tg', `Received ${signal}. Shutting down...`);
    bot.stopPolling();
    await subscriber.quit().catch(() => {});
    process.exit(0);
  };

  process.once('SIGINT', () => handleShutdown('SIGINT'));
  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`[gateway-tg] Fatal startup error: ${err.stack}`);
  process.exit(1);
});
