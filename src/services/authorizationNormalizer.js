function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).trim().replace(/\D/g, '');
}

function normalizeWaOutbound(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return '';
  if (digits.endsWith('@c.us')) return digits;
  return digits + '@c.us';
}

function normalizeIdentity(identity) {
  if (!identity) return '';
  return String(identity).trim().toLowerCase();
}

function extractIdentityFromMessage(message) {
  if (!message) return null;

  // For whatsapp messages
  const from = message.from ? normalizeIdentity(message.from) : '';
  const author = message.author ? normalizeIdentity(message.author) : '';
  const participant = message.participant ? normalizeIdentity(message.participant) : '';

  return {
    from,
    author,
    participant,
    identities: [from, author, participant].filter(Boolean)
  };
}

module.exports = {
  normalizePhone,
  normalizeWaOutbound,
  normalizeIdentity,
  extractIdentityFromMessage
};
