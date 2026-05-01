const { Jimp } = require('jimp');
const { createWorker } = require('tesseract.js');
const {
  decodeAppNoAndDobFromImage,
  normalizeDob,
} = require('./commandInputService');

const RECEIPT_CACHE_TTL_MS = 10 * 60 * 1000;
const receiptCache = new Map();
const rcReceiptCache = new Map();

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  const normalized = normalizeText(value)
    .replace(
      /\b(DATE OF BIRTH|DOB|APPLICATION NO|APPLICATION NUMBER|FATHER'?S NAME|RECEIPT NO|RECEIPT DATE|BANK REFERENCE NO|TRANSACTION ID)\b.*$/i,
      ''
    )
    .replace(/[^A-Z.\s]/gi, '')
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .trim();

  return normalized;
}

function sanitizeAppNoCandidate(value) {
  const cleaned = normalizeText(value)
    .replace(/\b(NAME|DATE|DOB|FATHER|APPLICANT)\b.*$/i, '')
    .replace(/[^A-Z0-9]/gi, '');
  if (!cleaned) {
    return '';
  }

  if (!/^[A-Z0-9]{8,20}$/i.test(cleaned)) {
    return '';
  }

  if (/^\d{6,8}$/.test(cleaned)) {
    return '';
  }

  return cleaned.toUpperCase();
}

function sanitizeRcApplicationNo(value) {
  const cleaned = normalizeText(value)
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();

  if (!/^[A-Z0-9]{10,22}$/.test(cleaned)) {
    return '';
  }

  // RC application numbers commonly include a state prefix and embedded V marker.
  if (!/^[A-Z]{2}\d/.test(cleaned)) {
    return '';
  }

  return cleaned;
}

function sanitizeVehicleNo(value) {
  const cleaned = normalizeText(value)
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();

  if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/.test(cleaned)) {
    return '';
  }

  return cleaned;
}

function normalizeOcrText(rawText) {
  return String(rawText || '')
    .replace(/\r/g, '\n')
    .replace(/[|]/g, ':')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractLabelValue(text, labelPattern, valuePattern) {
  const regex = new RegExp(`${labelPattern}\\s*[:\\-]?\\s*${valuePattern}`, 'i');
  const match = text.match(regex);
  return match ? normalizeText(match[1]) : '';
}

function collectCandidateAppNos(text) {
  const candidates = new Set();
  const labeledPatterns = [
    /Application\s*(?:No|Number)\s*(?:is)?\s*[:\-]?\s*([A-Z0-9\s/.-]{8,30})/gi,
    /Application Number is\s*[:\-]?\s*([A-Z0-9\s/.-]{8,30})/gi,
  ];

  for (const pattern of labeledPatterns) {
    let match = pattern.exec(text);
    while (match) {
      const candidate = sanitizeAppNoCandidate(match[1]);
      if (candidate) {
        candidates.add(candidate);
      }
      match = pattern.exec(text);
    }
  }

  const genericMatches = text.match(/\b[A-Z]{0,2}\d{8,20}\b/gi) || [];
  for (const value of genericMatches) {
    const candidate = sanitizeAppNoCandidate(value);
    if (candidate) {
      candidates.add(candidate);
    }
  }

  return Array.from(candidates);
}

function extractLabeledAppNo(text) {
  const lines = normalizeOcrText(text).split('\n').map((line) => normalizeText(line)).filter(Boolean);
  for (const line of lines) {
    if (!/Application\s*(No|Number)/i.test(line)) {
      continue;
    }

    const tail = line.replace(/^.*Application\s*(?:No|Number)\s*[:\-]?\s*/i, '');
    const tokenMatches = tail.match(/[A-Z0-9]{8,20}/gi) || [];
    for (const token of tokenMatches) {
      const candidate = sanitizeAppNoCandidate(token);
      if (candidate) {
        return candidate;
      }
    }
  }

  const labeledFromRegex = sanitizeAppNoCandidate(
    extractLabelValue(text, 'Application\\s*(?:No|Number)', '([A-Z0-9\\s/.-]{8,30})')
  );
  return labeledFromRegex;
}

function extractReceiptFieldsFromText(rawText) {
  const text = normalizeOcrText(rawText);
  if (!text) {
    return {
      appNo: '',
      dob: '',
      name: '',
      appNoCandidates: [],
      labeledAppNo: '',
      labeledDob: '',
    };
  }

  const labeledAppNo = extractLabeledAppNo(text);

  const dobRaw =
    extractLabelValue(text, 'Date\\s*of\\s*Birth', '(\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{2,4})') ||
    extractLabelValue(text, 'DOB', '(\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{2,4})');
  const labeledDob = normalizeDob(dobRaw);

  const lines = text.split('\n').map((line) => normalizeText(line)).filter(Boolean);
  let applicantNameRaw = extractLabelValue(text, 'Applicant\\s*Name', '([A-Z][A-Z\\s.]{2,80})');
  if (!applicantNameRaw) {
    for (const line of lines) {
      if (/father'?s\s*name/i.test(line)) {
        continue;
      }

      const match = line.match(/\bName\s*[:\-]\s*([A-Z][A-Z\s.]{2,80})/i);
      if (match) {
        applicantNameRaw = match[1];
        break;
      }
    }
  }
  const name = normalizeName(applicantNameRaw);

  const appNoCandidates = collectCandidateAppNos(text);
  const appNo = labeledAppNo || appNoCandidates[0] || '';

  return {
    appNo,
    dob: labeledDob,
    name,
    appNoCandidates,
    labeledAppNo,
    labeledDob,
  };
}

function pickRcApplicationToken(tokens) {
  const sanitized = tokens
    .map((token) => sanitizeRcApplicationNo(token))
    .filter(Boolean);
  if (sanitized.length === 0) {
    return '';
  }

  const withVMarker = sanitized.find((token) => /V\d{3,}/i.test(token));
  if (withVMarker) {
    return withVMarker;
  }

  const withoutCMarker = sanitized.find((token) => !/C\d{3,}/i.test(token));
  return withoutCMarker || sanitized[0];
}

function extractRcReceiptFieldsFromText(rawText) {
  const text = normalizeOcrText(rawText);
  if (!text) {
    return {
      applicationNo: '',
      receiptNo: '',
      vehicleNo: '',
      candidateApplicationNos: [],
      ambiguousApplicationNo: false,
      source: '',
    };
  }

  const lines = text
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean);

  let applicationNo = '';
  let receiptNo = '';
  let source = '';

  for (const line of lines) {
    if (!/Application\s*No\s*\/\s*Receipt\s*No/i.test(line)) {
      continue;
    }

    const rhs = line.replace(/^.*Application\s*No\s*\/\s*Receipt\s*No\s*[:\-]?\s*/i, '');
    const parts = rhs.split('/').map((part) => normalizeText(part)).filter(Boolean);
    const appToken = pickRcApplicationToken(parts);
    const receiptToken = sanitizeRcApplicationNo(parts[1] || '');

    if (appToken) {
      applicationNo = appToken;
      source = 'labeled';
    }
    if (receiptToken) {
      receiptNo = receiptToken;
    }
    break;
  }

  const candidateApplicationNos = [];
  const tokenMatches = text.match(/\b[A-Z]{2}\d{3,}[A-Z]\d{3,}\b/gi) || [];
  for (const token of tokenMatches) {
    const cleaned = sanitizeRcApplicationNo(token);
    if (cleaned && !candidateApplicationNos.includes(cleaned)) {
      candidateApplicationNos.push(cleaned);
    }
  }

  if (!applicationNo && candidateApplicationNos.length > 0) {
    applicationNo = pickRcApplicationToken(candidateApplicationNos);
    source = 'generic';
  }

  const vehicleNoRaw = extractLabelValue(text, 'Vehicle\\s*No\\.?', '([A-Z0-9\\s-]{6,20})');
  let vehicleNo = sanitizeVehicleNo(vehicleNoRaw);
  if (!vehicleNo) {
    const genericVehicleMatches = text.match(/\b[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}\b/gi) || [];
    vehicleNo = genericVehicleMatches
      .map((value) => sanitizeVehicleNo(value))
      .find((value) => value && value !== applicationNo && value !== receiptNo) || '';
  }

  let ambiguousApplicationNo =
    candidateApplicationNos.length > 1 &&
    !candidateApplicationNos.every((value) => value === applicationNo);
  if (ambiguousApplicationNo && /V\d{3,}/i.test(applicationNo)) {
    const vCandidates = candidateApplicationNos.filter((value) => /V\d{3,}/i.test(value));
    if (vCandidates.length === 1 && vCandidates[0] === applicationNo) {
      ambiguousApplicationNo = false;
    }
  }

  return {
    applicationNo,
    receiptNo,
    vehicleNo,
    candidateApplicationNos,
    ambiguousApplicationNo,
    source,
  };
}

async function recognizeText(buffer) {
  const worker = await createWorker('eng');
  try {
    const textChunks = [];
    const base = await worker.recognize(buffer);
    textChunks.push(normalizeOcrText(base && base.data && base.data.text));

    try {
      const image = await Jimp.read(buffer);
      image.greyscale().contrast(0.35);
      if (image.bitmap.width < 1600) {
        image.scale(2);
      }

      const processedBuffer = await image.getBuffer('image/png');
      const processed = await worker.recognize(processedBuffer);
      textChunks.push(normalizeOcrText(processed && processed.data && processed.data.text));
    } catch (error) {
      // Keep base OCR output when preprocessing fails.
    }

    return normalizeOcrText(textChunks.filter(Boolean).join('\n'));
  } finally {
    await worker.terminate();
  }
}

function buildExtractionResult({
  barcodeResult,
  textResult,
  ocrText,
}) {
  const appCandidates = new Set();
  if (textResult.labeledAppNo) {
    appCandidates.add(String(textResult.labeledAppNo).toUpperCase());
  } else if (barcodeResult.appNo) {
    appCandidates.add(String(barcodeResult.appNo).toUpperCase());
  }

  for (const candidate of textResult.appNoCandidates || []) {
    if (textResult.labeledAppNo && candidate !== textResult.labeledAppNo) {
      continue;
    }
    appCandidates.add(candidate);
  }

  const candidateList = Array.from(appCandidates);
  const ambiguousAppNo = candidateList.length > 1;
  const appNo = ambiguousAppNo ? '' : (candidateList[0] || '');
  const dob = textResult.dob || barcodeResult.dob || '';
  const name = textResult.name || '';

  let confidence = 0;
  if (textResult.labeledAppNo) {
    confidence += 0.6;
  } else if (barcodeResult.appNo) {
    confidence += 0.45;
  }
  if (textResult.labeledDob) {
    confidence += 0.25;
  } else if (barcodeResult.dob) {
    confidence += 0.15;
  }
  if (name) {
    confidence += 0.1;
  }
  if (ambiguousAppNo) {
    confidence = 0.2;
  }

  return {
    appNo,
    dob,
    name,
    rawValue: barcodeResult.rawValue || ocrText || '',
    appNoCandidates: candidateList,
    ambiguousAppNo,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
  };
}

async function extractReceiptTrackingCandidate(buffer, mimeType = 'image/jpeg') {
  const barcodeResult = await decodeAppNoAndDobFromImage(buffer, mimeType);
  let ocrText = '';
  let textResult = {
    appNo: '',
    dob: '',
    name: '',
    appNoCandidates: [],
    labeledAppNo: '',
    labeledDob: '',
  };

  try {
    ocrText = await recognizeText(buffer);
    textResult = extractReceiptFieldsFromText(ocrText);
  } catch (error) {
    // Keep the barcode-only fallback path when OCR is unavailable.
  }

  return buildExtractionResult({
    barcodeResult,
    textResult,
    ocrText,
  });
}

async function extractRcReceiptTrackingCandidate(buffer, mimeType = 'image/jpeg') {
  let ocrText = '';
  let textResult = {
    applicationNo: '',
    receiptNo: '',
    vehicleNo: '',
    candidateApplicationNos: [],
    ambiguousApplicationNo: false,
    source: '',
  };

  try {
    ocrText = await recognizeText(buffer);
    textResult = extractRcReceiptFieldsFromText(ocrText);
  } catch (error) {
    // keep empty fallback
  }

  let confidence = 0;
  if (textResult.source === 'labeled') {
    confidence += 0.7;
  } else if (textResult.applicationNo) {
    confidence += 0.45;
  }
  if (textResult.vehicleNo) {
    confidence += 0.25;
  }
  if (textResult.ambiguousApplicationNo) {
    confidence = 0.2;
  }

  return {
    appNo: textResult.applicationNo,
    receiptNo: textResult.receiptNo,
    vehicleNo: textResult.vehicleNo,
    appNoCandidates: textResult.candidateApplicationNos,
    ambiguousAppNo: textResult.ambiguousApplicationNo,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
    rawText: ocrText,
  };
}

function setReceiptTrackingCandidate(chatId, candidate) {
  const safeChatId = normalizeText(chatId);
  if (!safeChatId || !candidate || !candidate.appNo) {
    return false;
  }

  if (candidate.ambiguousAppNo || Number(candidate.confidence || 0) < 0.6) {
    return false;
  }

  receiptCache.set(safeChatId, {
    ...candidate,
    expiresAt: Date.now() + RECEIPT_CACHE_TTL_MS,
  });
  return true;
}

function getReceiptTrackingCandidate(chatId) {
  const safeChatId = normalizeText(chatId);
  if (!safeChatId) {
    return null;
  }

  const cached = receiptCache.get(safeChatId);
  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    receiptCache.delete(safeChatId);
    return null;
  }

  return cached;
}

function clearReceiptTrackingCandidate(chatId) {
  receiptCache.delete(normalizeText(chatId));
}

function setRcReceiptTrackingCandidate(chatId, candidate) {
  const safeChatId = normalizeText(chatId);
  if (!safeChatId || !candidate || !candidate.appNo) {
    return false;
  }

  if (candidate.ambiguousAppNo || Number(candidate.confidence || 0) < 0.6) {
    return false;
  }

  rcReceiptCache.set(safeChatId, {
    ...candidate,
    expiresAt: Date.now() + RECEIPT_CACHE_TTL_MS,
  });
  return true;
}

function getRcReceiptTrackingCandidate(chatId) {
  const safeChatId = normalizeText(chatId);
  if (!safeChatId) {
    return null;
  }

  const cached = rcReceiptCache.get(safeChatId);
  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    rcReceiptCache.delete(safeChatId);
    return null;
  }

  return cached;
}

function clearRcReceiptTrackingCandidate(chatId) {
  rcReceiptCache.delete(normalizeText(chatId));
}

module.exports = {
  extractReceiptFieldsFromText,
  extractReceiptTrackingCandidate,
  extractRcReceiptFieldsFromText,
  extractRcReceiptTrackingCandidate,
  setReceiptTrackingCandidate,
  getReceiptTrackingCandidate,
  clearReceiptTrackingCandidate,
  setRcReceiptTrackingCandidate,
  getRcReceiptTrackingCandidate,
  clearRcReceiptTrackingCandidate,
};
