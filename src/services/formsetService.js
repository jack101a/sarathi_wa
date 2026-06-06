const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { getAckPDF } = require('./ackService');
const { downloadForm } = require('./formService');
const { buildFormsetCaption } = require('../utils/serviceMessages');

function safeUnlink(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

async function loadPdfBytes(filePath) {
  return fs.readFileSync(filePath);
}

async function appendAllPages(targetPdf, sourceBytes) {
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const pageIndexes = sourcePdf.getPageIndices();
  const copiedPages = await targetPdf.copyPages(sourcePdf, pageIndexes);

  for (const page of copiedPages) {
    targetPdf.addPage(page);
  }
}

async function appendSelectedPages(targetPdf, sourceBytes, pageIndexes) {
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const availableIndexes = sourcePdf.getPageIndices();
  const selectedIndexes = pageIndexes.filter((index) => availableIndexes.includes(index));

  if (selectedIndexes.length !== pageIndexes.length) {
    throw new Error('Form 2 did not contain all required pages (1, 2, and 4).');
  }

  const copiedPages = await targetPdf.copyPages(sourcePdf, selectedIndexes);

  for (const page of copiedPages) {
    targetPdf.addPage(page);
  }
}

async function getFormset(appNo, dob) {
  if (!String(appNo || '').trim()) {
    throw new Error('Application number is required.');
  }

  if (!String(dob || '').trim()) {
    throw new Error('DOB is required.');
  }

  const mergedPdf = await PDFDocument.create();
  const includedDocuments = [];
  let ackPath;
  let form2Path;
  let form1aPath;

  try {
    ackPath = await getAckPDF(appNo, dob);
    await appendAllPages(mergedPdf, await loadPdfBytes(ackPath));
    includedDocuments.push('acknowledgement');

    form2Path = await downloadForm(appNo, dob, 'form2');
    await appendSelectedPages(mergedPdf, await loadPdfBytes(form2Path), [0, 1, 3]);
    includedDocuments.push('form2-pages-1-2-4');

    try {
      form1aPath = await downloadForm(appNo, dob, 'form1a');
      await appendAllPages(mergedPdf, await loadPdfBytes(form1aPath));
      includedDocuments.push('form1a');
    } catch (error) {
      form1aPath = null;
    }

    const buffer = Buffer.from(await mergedPdf.save());

    return {
      buffer,
      filename: `Formset_${appNo}.pdf`,
      includedDocuments,
      caption: buildFormsetCaption(appNo, includedDocuments),
    };
  } catch (error) {
    throw new Error(`Failed to build formset PDF: ${error.message}`);
  } finally {
    safeUnlink(ackPath);
    safeUnlink(form2Path);
    safeUnlink(form1aPath);
  }
}

module.exports = {
  getFormset,
};
