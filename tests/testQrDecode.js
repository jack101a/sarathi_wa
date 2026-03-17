const QRCode = require('qrcode');
const { decodeAppNoAndDobFromImage } = require('../src/services/commandInputService');

async function run() {
  const rawValue = 'Application No 123456789012 DOB 17-03-1990';
  const dataUrl = await QRCode.toDataURL(rawValue, {
    margin: 1,
    width: 300,
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  const decoded = await decodeAppNoAndDobFromImage(buffer, 'image/png');

  if (decoded.appNo !== '123456789012' || decoded.dob !== '17-03-1990') {
    throw new Error(`Unexpected decode result: ${JSON.stringify(decoded)}`);
  }

  console.log('PASS - QR decode');
}

run().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
