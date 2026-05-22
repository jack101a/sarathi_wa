const assert = require('assert');
const { parseStatusDetails } = require('../src/services/statusService');
const {
  deriveSarathiStatus,
  deriveVahanStatus,
  inferVahanService,
} = require('../src/services/imageGeneratorService');

function testSarathiApprovedHeading() {
  const details = parseStatusDetails(`
    <div>
      <fieldset>
        <h3 align="center">Licence has been Approved.</h3>
        <table><tbody></tbody></table>
      </fieldset>
    </div>
  `);

  assert.strictEqual(details.kind, 'approved');
  assert.match(details.message, /approved/i);
}

function testVahanObjectRows() {
  const snapshot = JSON.stringify({
    rows: [
      {
        transactionPurpose: 'TRANSFER OF OWNERSHIP',
        currentStatus: 'ONLINE TRANSACTION SUCCESS ON 10-Mar-2026 14:08:29',
      },
    ],
    rcPrintOrSmartCardStatus: 'RC PRINTED ON 12-Mar-2026',
    dispatchRcStatus: 'Not Available',
  });

  const status = deriveVahanStatus(snapshot);
  assert.match(status.scrutiny, /10-03-2026/);
  assert.match(status.approval, /10-03-2026/);
  assert.strictEqual(status.dispatched, 'Pending');
}

function testVahanNotInwardedIsPending() {
  const snapshot = JSON.stringify({
    rows: [
      {
        transactionPurpose: 'Fitness Inspection/Certificate',
        currentStatus: 'ONLINE TRANSACTION SUCCESS ON 07-May-2026 13:59:11 BUT NOT INWARDED AT R.T.O.BORIVALI (MH-47)',
      },
    ],
    rcPrintOrSmartCardStatus: 'Not Available',
    dispatchRcStatus: 'Not Available',
  });

  const status = deriveVahanStatus(snapshot);
  assert.strictEqual(status.scrutiny, 'Pending');
  assert.strictEqual(status.approval, 'Pending');
  assert.strictEqual(status.dispatched, 'Pending');
}

function testVahanServiceInferenceIgnoresFeeRows() {
  const service = inferVahanService({
    rows: [
      { transactionPurpose: 'Hypothecation Termination', currentStatus: 'COMPLETED / APPROVED ON 27-Mar-2026' },
      { transactionPurpose: 'Issue of Duplicate RC', currentStatus: 'COMPLETED / APPROVED ON 27-Mar-2026' },
      { transactionPurpose: 'Postal Fee', currentStatus: 'ONLINE TRANSACTION SUCCESS ON 10-Mar-2026' },
      { transactionPurpose: 'Smart Card Fee', currentStatus: 'ONLINE TRANSACTION SUCCESS ON 10-Mar-2026' },
    ],
  });
  assert.strictEqual(service, 'Hypothecation Termination, Issue of Duplicate RC');
}

function run() {
  testSarathiApprovedHeading();
  testVahanObjectRows();
  testVahanNotInwardedIsPending();
  testVahanServiceInferenceIgnoresFeeRows();
  console.log('PASS - status table mapping');
}

run();
