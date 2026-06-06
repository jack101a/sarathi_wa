const assert = require('assert');
const {
  isTerminalApplyDLDialog,
  normalizePortalMessage,
} = require('../src/services/applyDlService');

assert.strictEqual(
  normalizePortalMessage('Please Apply Your DL After 30  Days'),
  'Please Apply Your DL After 30 Days'
);

assert.strictEqual(
  isTerminalApplyDLDialog('Please Apply Your DL After 30  Days'),
  true
);

assert.strictEqual(
  isTerminalApplyDLDialog('Application already exist for this learner licence'),
  true
);

assert.strictEqual(
  isTerminalApplyDLDialog('Captcha entered is wrong'),
  false
);

assert.strictEqual(
  isTerminalApplyDLDialog(''),
  false
);

console.log('Apply DL portal dialog tests passed.');
