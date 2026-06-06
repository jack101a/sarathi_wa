function isRegisterCommand(text) {
  return /^\/register\b/i.test(String(text || '').trim());
}

function normalizeName(input) {
  return String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizePhone(input) {
  return String(input || '').trim().replace(/\D/g, '');
}

function normalizeIndianMobile(input) {
  let digits = normalizePhone(input);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(digits)) return '';
  return digits;
}

function outboundJidForMobile(mobile10) {
  return `91${mobile10}@c.us`;
}

module.exports = {
  isRegisterCommand,
  normalizeName,
  normalizeIndianMobile,
  outboundJidForMobile,
};
