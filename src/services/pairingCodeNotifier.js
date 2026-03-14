const { notifyPairingCode } = require('../utils/discordNotifier');
const { notifyFirstAuthorizedChat } = require('../telegramBot');

function formatPairingCode(code) {
  const raw = String(code || '').replace(/\s+/g, '').trim();
  if (!raw) {
    return '';
  }

  return raw.match(/.{1,4}/g)?.join(' ') || raw;
}

async function broadcastPairingCode(code, config) {
  const formattedCode = formatPairingCode(code);

  if (!formattedCode) {
    throw new Error('Pairing code is empty.');
  }

  const message = [
    'WhatsApp pairing code generated.',
    `Code: ${formattedCode}`,
    'Use Linked Devices > Link with phone number in WhatsApp to enter this code.',
  ].join('\n');

  const results = await Promise.allSettled([
    notifyPairingCode(formattedCode),
    notifyFirstAuthorizedChat(config, message),
  ]);

  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || String(result.reason || 'Unknown notification error'));

  if (failures.length === results.length) {
    throw new Error(`All pairing code notifications failed: ${failures.join(' | ')}`);
  }

  return {
    message,
    notifiedDiscord: results[0].status === 'fulfilled' ? results[0].value : false,
    notifiedTelegram: results[1].status === 'fulfilled' ? results[1].value : false,
    failures,
  };
}

module.exports = {
  broadcastPairingCode,
  formatPairingCode,
};
