const { Jimp } = require('jimp');
const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} = require('@zxing/library');

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDob(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }

  const match = raw.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
  if (!match) {
    return '';
  }

  let year;
  let month;
  let day;

  if (match[1].length === 4) {
    year = match[1];
    month = match[2].padStart(2, '0');
    day = match[3].padStart(2, '0');
  } else {
    day = match[1].padStart(2, '0');
    month = match[2].padStart(2, '0');
    year = match[3].length === 2 ? `19${match[3]}` : match[3];
  }

  return `${day}-${month}-${year}`;
}

function extractAppNoAndDob(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return {
      appNo: '',
      dob: '',
      sourceText: '',
    };
  }

  const dobMatch = normalized.match(/\b(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4})\b/);
  const appMatches = normalized.match(/\b\d{8,20}\b/g) || [];
  const dob = dobMatch ? normalizeDob(dobMatch[1]) : '';
  const dobDigits = dobMatch ? dobMatch[1].replace(/\D/g, '') : '';
  const appNo = appMatches.find((value) => value !== dobDigits) || appMatches[0] || '';

  return {
    appNo,
    dob,
    sourceText: normalized,
  };
}

async function decodeAppNoAndDobFromImage(buffer, mimeType = 'image/jpeg') {
  if (!buffer || !buffer.length) {
    return {
      appNo: '',
      dob: '',
      rawValue: '',
    };
  }

  try {
    const image = await Jimp.read(buffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const rgba = image.bitmap.data;
    const luminances = new Uint8ClampedArray(width * height);

    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4, targetIndex += 1) {
      const r = rgba[sourceIndex];
      const g = rgba[sourceIndex + 1];
      const b = rgba[sourceIndex + 2];
      luminances[targetIndex] = (r + g * 2 + b) >> 2;
    }

    const source = new RGBLuminanceSource(luminances, width, height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    const reader = new MultiFormatReader();
    const hints = new Map();

    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.CODABAR,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.PDF_417,
      BarcodeFormat.AZTEC,
      BarcodeFormat.ITF,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const result = reader.decode(bitmap, hints);

    const rawValue = String(result.getText ? result.getText() : result.text || '').trim();
    const parsed = extractAppNoAndDob(rawValue);
    return {
      ...parsed,
      rawValue,
    };
  } catch (error) {
    return {
      appNo: '',
      dob: '',
      rawValue: '',
      error: error.message,
    };
  }
}

module.exports = {
  normalizeDob,
  extractAppNoAndDob,
  decodeAppNoAndDobFromImage,
};
