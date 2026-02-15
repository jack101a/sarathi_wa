/**
 * Form service responsibility:
 * Download Sarathi form PDFs from upstream endpoint.
 */

const CONFIG = require('../config/config');
const httpClient = require('../core/httpClient');
const { getSessionCookie } = require('../core/sessionManager');
const fs = require('fs');
const path = require('path');

function cleanBase64(input) {
  return String(input || '')
    .trim()
    .replace(/^['\"]+|['\"]+$/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
}

async function downloadForm(appNo, dob, formName) {
  if (!String(appNo || '').trim()) {
    throw new Error('Application number is required.');
  }

  if (!String(dob || '').trim()) {
    throw new Error('DOB is required.');
  }

  if (!String(formName || '').trim()) {
    throw new Error('Form name is required.');
  }

  if (!CONFIG.URLS.FORM) {
    throw new Error('FORM URL is not configured.');
  }

  try {
    const cookie = await getSessionCookie();

    const body =
      `applno=${encodeURIComponent(appNo)}` +
      `&dateOfBirth=${encodeURIComponent(dob)}` +
      '&typeofmode=pdfwithoutsign' +
      `&formname=${encodeURIComponent(formName)}`;

    const response = await httpClient.post(CONFIG.URLS.FORM, body, {
      responseType: 'text',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': CONFIG.HTTP.USER_AGENT,
        Cookie: cookie,
        Origin: CONFIG.URLS.HOME,
        Referer: CONFIG.URLS.HOME,
      },
    });

    const base64 = cleanBase64(response.data);

    if (!base64.startsWith('JVBERi')) {
      throw new Error('Invalid PDF response');
    }

    const filename = `${formName}_${appNo}.pdf`;
    const outputPath = path.join(process.cwd(), filename);

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));

    return outputPath;
  } catch (error) {
    throw new Error(`Failed to download ${formName} PDF: ${error.message}`);
  }
}

module.exports = {
  downloadForm,
};
