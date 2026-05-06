const { isAuthorizedWhatsApp, isAuthorizedTelegram, isAdminWhatsApp, getWhatsAppSenderId } = require('../services/authorizationService');

async function isAuthorized(message, config) { return isAuthorizedWhatsApp(message, config); }
async function isAdminUser(message, config) { return isAdminWhatsApp(message, config); }
async function isTgAuthorized(msg, config) { return isAuthorizedTelegram(msg, config); }

module.exports = { isAuthorized, isTgAuthorized, isAdminUser, getWhatsAppSenderId };
