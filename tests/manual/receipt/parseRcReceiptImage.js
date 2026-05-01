const fs = require('fs');
const path = require('path');
const { extractRcReceiptTrackingCandidate } = require('../../../src/services/receiptInputService');

async function run() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('Usage: node tests/manual/receipt/parseRcReceiptImage.js <image_path>');
    process.exit(1);
  }

  const absolutePath = path.resolve(imagePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Image not found: ${absolutePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(absolutePath);
  const result = await extractRcReceiptTrackingCandidate(buffer, 'image/jpeg');

  console.log(JSON.stringify({
    imagePath: absolutePath,
    applicationNo: result.appNo,
    receiptNo: result.receiptNo,
    vehicleNo: result.vehicleNo,
    confidence: result.confidence,
    ambiguousAppNo: result.ambiguousAppNo,
    appNoCandidates: result.appNoCandidates,
  }, null, 2));
}

run().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
