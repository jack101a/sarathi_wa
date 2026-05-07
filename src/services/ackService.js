/**
 * Ack service responsibility:
 * Fetch acknowledgement receipt using browser session and export PDF.
 */

const CONFIG = require('../config/config');
const { getBrowser } = require('../core/puppeteerEngine');
const { getTempFilePath } = require('../core/tempFiles');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function getFirstName(name) {
  const safeName = String(name || '').trim();
  if (!safeName) {
    return 'Applicant';
  }

  const first = safeName.split(/\s+/)[0] || 'Applicant';
  return first.replace(/[^a-zA-Z0-9_-]/g, '') || 'Applicant';
}

async function getAckPDF(appNo, dob) {
  if (!String(appNo || '').trim()) {
    throw new Error('Application number is required.');
  }

  if (!String(dob || '').trim()) {
    throw new Error('DOB is required.');
  }

  let page;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto(`${CONFIG.URLS.HOME}stateSelection.do`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const closeButton = await page.$(
      '.close, button.close, .modal .btn-close, .modal button[data-dismiss="modal"]'
    );
    if (closeButton) {
      await closeButton.click();
    }

    const selector = 'select.form-control.input-sm';
    await page.waitForSelector(selector, { timeout: 60000 });
    await page.select(selector, CONFIG.STATE_CODE);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const receipt = await fetchAckReceipt(page, appNo, dob);

    if (!receipt || !receipt.content) {
      throw new Error('Acknowledgement content was not found.');
    }

    const firstName = getFirstName(receipt.nameText);
    const filename = `${firstName}_${appNo}.pdf`;
    const outputPath = getTempFilePath(filename);

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    await page.setContent(
      `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Acknowledgement Receipt</title>
    <style>
      @page {
        size: A4;
        margin: 10mm;
      }
      html, body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    ${receipt.content}
  </body>
</html>`,
      { waitUntil: 'domcontentloaded' }
    );

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      pageRanges: '1',
      margin: {
        top: '10mm',
        bottom: '10mm',
        left: '10mm',
        right: '10mm',
      },
    });

    return outputPath;
  } catch (error) {
    throw new Error(`Failed to generate acknowledgement PDF: ${error.message}`);
  } finally {
    if (page) {
      await page.close();
    }
  }
}

async function fetchAckReceipt(page, appNo, dob) {
  return page.evaluate(
    async ({ ackBaseUrl, appNoArg, dobArg }) => {
      const url = `${ackBaseUrl}?applNum=${encodeURIComponent(
        appNoArg
      )}&dateOfBirth=${encodeURIComponent(dobArg)}&type=ack`;

      const res = await fetch(url, {
        credentials: 'include',
      });

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const receiptNode = doc.querySelector('#divToPrint');
      const qrDiv = doc.querySelector('#QRDiv');
      let combinedHTML = receiptNode ? receiptNode.outerHTML : '';
      if (qrDiv) {
        combinedHTML += qrDiv.outerHTML;
      }

      let nameText = '';
      const rows = Array.from(doc.querySelectorAll('tr'));
      for (const row of rows) {
        if ((row.textContent || '').includes('Name')) {
          const cells = row.querySelectorAll('td');
          if (cells.length > 1) {
            nameText = (cells[cells.length - 1].textContent || '').trim();
          } else {
            nameText = (row.textContent || '').replace(/Name[:\s]*/i, '').trim();
          }
          break;
        }
      }

      return {
        content: combinedHTML,
        nameText,
      };
    },
    {
      ackBaseUrl: CONFIG.URLS.ACK,
      appNoArg: appNo,
      dobArg: dob,
    }
  );
}

function buildAckHTML(content) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Acknowledgement Receipt</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 18px;
        background: #f4f7fb;
        font-family: Arial, sans-serif;
      }
      .sheet {
        width: 820px;
        margin: 0 auto;
        background: #fff;
        border: 1px solid #d9e2ee;
        border-radius: 10px;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
        overflow: hidden;
      }
      .sheet > * {
        width: 100% !important;
      }
      table {
        width: 100% !important;
      }
      img {
        max-width: 100%;
      }
    </style>
  </head>
  <body>
    <div class="sheet">${content}</div>
  </body>
</html>`;
}

function parseAckDetails(html) {
  const $ = cheerio.load(html || '');
  const detailMap = {};

  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    for (let index = 0; index + 1 < cells.length; index += 2) {
      const label = String($(cells[index]).text() || '')
        .replace(/[:\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const value = String($(cells[index + 1]).text() || '')
        .replace(/^[:\s]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (label && value) {
        detailMap[label] = value;
      }
    }
  });

  const servicesRequested = $('td b')
    .toArray()
    .map((node) => String($(node).text() || '').replace(/\s+/g, ' ').trim())
    .filter((text) => /^\d+\.\s+/.test(text));

  return {
    name: detailMap.name || '',
    applicationDate:
      detailMap['application date'] ||
      detailMap['appl date'] ||
      detailMap['application submission date'] ||
      detailMap['submission date'] ||
      detailMap.date ||
      '',
    serviceRequested: servicesRequested.join(', '),
  };
}

async function getAckSnapshot(appNo, dob, options = {}) {
  if (!String(appNo || '').trim()) {
    throw new Error('Application number is required.');
  }

  if (!String(dob || '').trim()) {
    throw new Error('DOB is required.');
  }

  const { keepFile = false, filename = `Ack_${appNo}.jpg` } = options;
  let page;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto(`${CONFIG.URLS.HOME}stateSelection.do`, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const closeButton = await page.$(
      '.close, button.close, .modal .btn-close, .modal button[data-dismiss="modal"]'
    );
    if (closeButton) {
      await closeButton.click();
    }

    const selector = 'select.form-control.input-sm';
    await page.waitForSelector(selector, { timeout: 60000 });
    await page.select(selector, CONFIG.STATE_CODE);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const receipt = await fetchAckReceipt(page, appNo, dob);

    if (!receipt || !receipt.content) {
      throw new Error('Acknowledgement content was not found.');
    }

    const outputPath = getTempFilePath(filename);
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    await page.setViewport({
      width: 850,
      height: 1400,
      deviceScaleFactor: 2,
    });

    await page.setContent(buildAckHTML(receipt.content), {
      waitUntil: 'domcontentloaded',
    });

    await page.screenshot({
      path: outputPath,
      fullPage: true,
    });

    const buffer = fs.readFileSync(outputPath);
    if (!keepFile) {
      fs.unlinkSync(outputPath);
    }

    return {
      html: receipt.content,
      filePath: outputPath,
      buffer,
      nameText: receipt.nameText,
      ackDetails: parseAckDetails(receipt.content),
    };
  } catch (error) {
    throw new Error(`Failed to generate acknowledgement image: ${error.message}`);
  } finally {
    if (page) {
      await page.close();
    }
  }
}

async function getAckImage(appNo, dob) {
  const snapshot = await getAckSnapshot(appNo, dob, {
    keepFile: true,
    filename: `Ack_${appNo}.jpg`,
  });

  return snapshot.filePath;
}

module.exports = {
  getAckPDF,
  getAckImage,
  getAckSnapshot,
  parseAckDetails,
};
