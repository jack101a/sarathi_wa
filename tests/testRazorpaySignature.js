const assert = require('assert');
const crypto = require('crypto');

process.env.RAZORPAY_WEBHOOK_SECRET = 'test_secret';
const razorpayService = require('../packages/common/src/razorpayService');

const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } }));
const goodSignature = crypto
  .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
  .update(rawBody.toString())
  .digest('hex');

assert.strictEqual(razorpayService.verifyWebhookSignature(rawBody, goodSignature), true);
assert.strictEqual(razorpayService.verifyWebhookSignature(rawBody, 'bad_signature'), false);

console.log('Razorpay signature tests passed.');
