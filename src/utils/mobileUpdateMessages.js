'use strict';

function sanitizePortalMessage(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function isPortalFailureMessage(value) {
  return /(busy|unavailable|try again|failed|failure|error|unable|temporar|service\s+down|server\s+down|not\s+responding)/i
    .test(sanitizePortalMessage(value));
}

function getMobileUpdateFailureMessage(error) {
  const portalMessage = sanitizePortalMessage(error && error.publicMessage);
  if (portalMessage) {
    return `${portalMessage}\n\nProcessing stopped. Please try again later.`;
  }
  return 'We could not complete the mobile update. Processing stopped. Please try again later.';
}

module.exports = {
  sanitizePortalMessage,
  isPortalFailureMessage,
  getMobileUpdateFailureMessage,
};
