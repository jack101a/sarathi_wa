const {
  isAuthorizedWhatsApp,
  isAuthorizedTelegram,
  isAdminWhatsApp,
  getWhatsAppSenderId
} = require('../services/authorizationService');

function isAuthorized(message, config) {
  return isAuthorizedWhatsApp(message, config);
}

function isAdminUser(message, config) {
  return isAdminWhatsApp(message, config);
}

function isTgAuthorized(msg, config) {
  return isAuthorizedTelegram(msg, config);
}

module.exports = {
  isAuthorized,
  isTgAuthorized,
  isAdminUser,
  getWhatsAppSenderId
};
