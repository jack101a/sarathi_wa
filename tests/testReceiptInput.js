const assert = require('assert');
const {
  clearRcReceiptTrackingCandidate,
  clearReceiptTrackingCandidate,
  extractRcReceiptFieldsFromText,
  extractReceiptFieldsFromText,
  getRcReceiptTrackingCandidate,
  getReceiptTrackingCandidate,
  setRcReceiptTrackingCandidate,
  setReceiptTrackingCandidate,
} = require('../src/services/receiptInputService');

function run() {
  const eReceiptText = `
    Transport Department Government of Maharashtra
    e-Receipt For Online Driving License Application
    Applicant Name : SUDARSHANADEVI CHAUHAN
    Date of Birth : 27-11-1982
    Application No : 1065615626
  `;
  const eReceiptResult = extractReceiptFieldsFromText(eReceiptText);
  assert.strictEqual(eReceiptResult.appNo, '1065615626');
  assert.strictEqual(eReceiptResult.dob, '27-11-1982');
  assert.strictEqual(eReceiptResult.name, 'SUDARSHANADEVI CHAUHAN');

  const refSlipText = `
    Application Reference Slip
    Application No : 1291500826
    Name : SAHIL SHAH
    Date of Birth : 21-06-1992
    Father's Name : KIRAN SHAH
  `;
  const refSlipResult = extractReceiptFieldsFromText(refSlipText);
  assert.strictEqual(refSlipResult.appNo, '1291500826');
  assert.strictEqual(refSlipResult.dob, '21-06-1992');
  assert.strictEqual(refSlipResult.name, 'SAHIL SHAH');

  const chatId = '120363040000000000@g.us';
  clearReceiptTrackingCandidate(chatId);
  const created = setReceiptTrackingCandidate(chatId, {
    appNo: '1291500826',
    dob: '21-06-1992',
    name: 'SAHIL SHAH',
    confidence: 0.8,
    ambiguousAppNo: false,
  });
  assert.strictEqual(created, true);
  const cached = getReceiptTrackingCandidate(chatId);
  assert.ok(cached);
  assert.strictEqual(cached.appNo, '1291500826');
  clearReceiptTrackingCandidate(chatId);
  assert.strictEqual(getReceiptTrackingCandidate(chatId), null);

  const rcReceiptText = `
    TAX RECEIPT
    Application No. / Receipt No.: MH260330V2859721 / MH260330C2874967
    Vehicle No.: MH02BU3695
  `;
  const rcResult = extractRcReceiptFieldsFromText(rcReceiptText);
  assert.strictEqual(rcResult.applicationNo, 'MH260330V2859721');
  assert.strictEqual(rcResult.vehicleNo, 'MH02BU3695');

  clearRcReceiptTrackingCandidate(chatId);
  const rcCreated = setRcReceiptTrackingCandidate(chatId, {
    appNo: 'MH260330V2859721',
    vehicleNo: 'MH02BU3695',
    confidence: 0.8,
    ambiguousAppNo: false,
  });
  assert.strictEqual(rcCreated, true);
  const cachedRc = getRcReceiptTrackingCandidate(chatId);
  assert.ok(cachedRc);
  assert.strictEqual(cachedRc.appNo, 'MH260330V2859721');
  assert.strictEqual(cachedRc.vehicleNo, 'MH02BU3695');
  clearRcReceiptTrackingCandidate(chatId);
  assert.strictEqual(getRcReceiptTrackingCandidate(chatId), null);

  console.log('PASS - receipt input parsing and cache');
}

run();
