'use strict';

function isKnown(value) {
  const normalized = String(value || '').trim();
  return normalized && normalized.toLowerCase() !== 'unknown';
}

function buildDlApplicationSummary(details = {}) {
  const extractedText = String(details.extractedText || '').trim();
  const extractedAppNo = extractedText.match(/Application No\s*:\s*(\d+)/i)?.[1];
  const extractedName = extractedText.match(/Name\s*:\s*([^,\n]+)/i)?.[1]?.trim();
  const appNo = isKnown(details.appNo) ? String(details.appNo).trim() : extractedAppNo;
  const name = isKnown(details.name) ? String(details.name).trim() : extractedName;

  if (appNo && name) return `Application No: ${appNo}, Name: ${name}`;
  if (appNo) return `Application No: ${appNo}`;
  if (extractedText) return extractedText;
  return 'DL application submitted successfully.';
}

function buildFormsetCaption(appNo, includedDocuments = []) {
  const documents = ['acknowledgement', 'form2'];
  if (includedDocuments.includes('form1a')) {
    documents.push('medical');
  }
  return `Formset_${appNo} [${documents.join('+')}]`;
}

module.exports = {
  buildDlApplicationSummary,
  buildFormsetCaption,
};
