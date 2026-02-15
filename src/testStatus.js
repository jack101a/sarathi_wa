const CONFIG = require('./config/config');
const { getVisualStatus } = require('./services/statusService');

(async () => {
  try {
    const appNo = process.env.TEST_APP_NO || '655728526';

    console.log('Testing status fetch...');
    console.log('Status URL:', CONFIG.URLS.STATUS);

    const file = await getVisualStatus(appNo);

    console.log('Generated file:', file);
  } catch (err) {
    console.error('Test failed:', err.message);
  }
})();
