const assert = require('assert');
const { buildTrackingSignature } = require('../src/services/autoTrackService');

function run() {
  const approvedSnapshot = {
    html: '',
    ackDetails: {
      name: 'USER NAME',
      serviceRequested: '1. Renewal of DL',
    },
    details: {
      kind: 'approved',
      stage: 'PRINTING OF DL IN FORM 7',
      approvedAction: 'APPROVAL OF ENDORSEMENTS ON DL',
      approvedOn: '17-03-2026',
      message: '',
      dlNumber: '',
      trackerNo: '',
    },
  };
  const dispatchedSnapshot = {
    html: '',
    ackDetails: {
      name: 'USER NAME',
      serviceRequested: '1. Renewal of DL',
    },
    details: {
      kind: 'dispatched',
      stage: 'PRINTING OF DL IN FORM 7',
      approvedAction: '',
      approvedOn: '17-03-2026',
      message: 'Licence has been dispatched',
      dlNumber: 'MH02 19900019317',
      trackerNo: 'TA845436923IN',
    },
  };

  assert.notStrictEqual(
    buildTrackingSignature(approvedSnapshot),
    buildTrackingSignature(dispatchedSnapshot),
    'Dispatch update should differ from approved update.'
  );

  console.log('PASS - auto track until dispatch signature');
}

run();
