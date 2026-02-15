const CONFIG = require('./config/config');
const { getAckPDF } = require('./services/ackService');

(async () => {
  try {
    const appNo = process.env.TEST_APP_NO || '655728526';
    const dob = process.env.TEST_DOB || '15-06-1993';

    console.log('Testing ACK fetch...');
    console.log('ACK URL:', CONFIG.URLS.ACK);

    const file = await getAckPDF(appNo, dob);
    console.log('Generated:', file);
  } catch (err) {
    console.error('Failed:', err.message);
  }
})();
