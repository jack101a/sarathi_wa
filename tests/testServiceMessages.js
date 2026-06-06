const assert = require('assert');
const {
  buildDlApplicationSummary,
  buildFormsetCaption,
} = require('../src/utils/serviceMessages');

assert.strictEqual(
  buildDlApplicationSummary({
    appNo: '2453595326',
    name: 'PRANAY JAY KHOPRE',
    extractedText: 'Application No: 2453595326, Name: PRANAY JAY KHOPRE',
  }),
  'Application No: 2453595326, Name: PRANAY JAY KHOPRE'
);

assert.strictEqual(
  buildDlApplicationSummary({
    extractedText: 'Application No: 2453595326, Name: PRANAY JAY KHOPRE',
  }),
  'Application No: 2453595326, Name: PRANAY JAY KHOPRE'
);

assert.strictEqual(
  buildFormsetCaption('2453595326', ['acknowledgement', 'form2-pages-1-2-4']),
  'Formset_2453595326 [acknowledgement+form2]'
);

assert.strictEqual(
  buildFormsetCaption('2453595326', ['acknowledgement', 'form2-pages-1-2-4', 'form1a']),
  'Formset_2453595326 [acknowledgement+form2+medical]'
);

console.log('Service message tests passed.');
