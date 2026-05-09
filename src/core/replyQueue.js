// src/core/replyQueue.js
// Singleton FIFO queue that serializes all outbound WhatsApp messages.
// Prevents burst-sending that causes WhatsApp to flag bot accounts.

const REPLY_DELAY_MS = Math.max(500, Number(process.env.WA_REPLY_DELAY_MS || 1500));

let _queue = [];
let _processing = false;
let _lastSentAt = 0;

async function _drain() {
  if (_processing) return;
  _processing = true;
  while (_queue.length > 0) {
    const { fn, resolve, reject } = _queue.shift();
    const now = Date.now();
    const wait = REPLY_DELAY_MS - (now - _lastSentAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const result = await fn();
      _lastSentAt = Date.now();
      resolve(result);
    } catch (e) {
      reject(e);
    }
  }
  _processing = false;
}

/**
 * Enqueue a send function. Returns a Promise that resolves when the message is sent.
 * Usage: await replyQueue.send(() => client.sendMessage(chatId, text));
 */
function send(fn) {
  return new Promise((resolve, reject) => {
    _queue.push({ fn, resolve, reject });
    _drain().catch(() => {});
  });
}

module.exports = { send };
