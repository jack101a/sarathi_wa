'use strict';
/**
 * razorpayService.js
 *
 * Handles Razorpay QR code creation and webhook signature verification.
 *
 * Flow:
 *   1. User types "topup 200"
 *   2. createPaymentQR(200, userId, chatId, transport) → returns { qrId, imageUrl }
 *   3. Gateway downloads imageUrl → sends as WhatsApp/TG image
 *   4. User scans with any UPI app → pays
 *   5. Razorpay fires webhook → POST /admin/api/payments/razorpay/webhook
 *   6. verifyWebhookSignature() validates it
 *   7. Handler looks up userId from QR notes → credits user → notifies via Redis
 *
 * If RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set, QR creation returns null.
 */

const crypto = require('crypto');

const KEY_ID     = process.env.RAZORPAY_KEY_ID     || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET  || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

/**
 * Returns true if Razorpay is configured via environment variables.
 */
function isRazorpayEnabled() {
  return Boolean(KEY_ID && KEY_SECRET);
}

/**
 * Creates a Razorpay UPI QR code for a specific amount.
 *
 * @param {number} amountInRupees - Amount to charge (e.g. 100 for ₹100)
 * @param {string} userId         - Internal user ID (stored in QR notes for webhook lookup)
 * @param {string} chatId         - User's chat JID / TG chat ID (for notification after payment)
 * @param {string} transport      - 'whatsapp' | 'telegram'
 * @returns {Promise<{qrId: string, imageUrl: string}|null>}
 */
async function createPaymentQR(amountInRupees, userId, chatId, transport) {
  if (!isRazorpayEnabled()) return null;

  // Lazy-load Razorpay SDK to avoid startup crash if not installed
  let Razorpay;
  try {
    Razorpay = require('razorpay');
  } catch (err) {
    console.warn('[razorpayService] razorpay npm package not installed. Run: npm install razorpay');
    return null;
  }

  const instance = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });

  const amountInPaise = Math.round(amountInRupees) * 100; // Razorpay uses paise

  try {
    const qr = await instance.qrCode.create({
      type: 'upi_qr',
      name: process.env.RAZORPAY_QR_NAME || 'Sarathi Bot',
      usage: 'single_use',       // auto-closes after one payment
      fixed_amount: true,
      payment_amount: amountInPaise,
      description: `Sarathi Credit Topup — ₹${amountInRupees}`,
      notes: {
        user_id:   String(userId),
        chat_id:   String(chatId),
        transport: String(transport),
        amount:    String(amountInRupees),
      },
    });

    return {
      qrId:     qr.id,
      imageUrl: qr.image_url,
    };
  } catch (err) {
    console.error(`[razorpayService] Failed to create QR: ${err.message}`);
    return null;
  }
}

/**
 * Verifies a Razorpay webhook signature.
 * Must be called with the RAW request body (Buffer or string), not parsed JSON.
 *
 * @param {string|Buffer} rawBody      - Raw request body from Express
 * @param {string}        signature    - Value of x-razorpay-signature header
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET) {
    if ((process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase() === 'production') {
      console.warn('[razorpayService] RAZORPAY_WEBHOOK_SECRET not set — rejecting production webhook');
      return false;
    }
    console.warn('[razorpayService] RAZORPAY_WEBHOOK_SECRET not set — skipping signature check outside production');
    return true;
  }
  const digest = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody.toString())
    .digest('hex');
  return digest === signature;
}

module.exports = {
  isRazorpayEnabled,
  createPaymentQR,
  verifyWebhookSignature,
};
