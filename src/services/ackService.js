/**
 * Ack service responsibility:
 * Fetch acknowledgement receipt using browser session and export PDF.
 */

const CONFIG = require('../config/config');
const { getBrowser } = require('../core/puppeteerEngine');
const fs = require('fs');
const path = require('path');

function getFirstName(name) {
  const safeName = String(name || '').trim();
  if (!safeName) {
    return 'Applicant';
  }

  const first = safeName.split(/\s+/)[0] || 'Applicant';
  return first.replace(/[^a-zA-Z0-9_-]/g, '') || 'Applicant';
}

function sanitizeReceiptHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/^\s*\/\/\s*alert.*$/gim, '')
    .replace(/^\s*alert\s*\(.*?\)\s*;?\s*$/gim, '')
    .trim();
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

    const receipt = await page.evaluate(
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
        if (receiptNode) {
          receiptNode.querySelectorAll('script').forEach((node) => node.remove());
        }

        const qr = doc.querySelector('#QRid')?.value || '';

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
          content: receiptNode ? receiptNode.outerHTML : '',
          qr,
          nameText,
        };
      },
      {
        ackBaseUrl: CONFIG.URLS.ACK,
        appNoArg: appNo,
        dobArg: dob,
      }
    );

    if (!receipt || !receipt.content) {
      throw new Error('Acknowledgement content was not found.');
    }

    const sanitizedContent = sanitizeReceiptHtml(receipt.content);
    if (!sanitizedContent) {
      throw new Error('Acknowledgement content is empty after sanitization.');
    }

    const firstName = getFirstName(receipt.nameText);
    const filename = `${firstName}_${appNo}.pdf`;
    const outputPath = path.join(process.cwd(), filename);

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const qrValue = JSON.stringify(receipt.qr || '');
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
    ${sanitizedContent}
    <script>
      (function () {
        var qrValue = ${qrValue};
        if (!qrValue) {
          return;
        }

        var targetSelectors = ['#barcode', '#qrcode', '#qrCode', '#QRCode', '#qrImg'];
        var target = null;

        for (var i = 0; i < targetSelectors.length; i += 1) {
          target = document.querySelector(targetSelectors[i]);
          if (target) {
            break;
          }
        }

        if (!target) {
          return;
        }

        var value = String(qrValue).trim();
        if (/^<svg[\s\S]*<\/svg>$/i.test(value)) {
          target.innerHTML = value;
          return;
        }

        if (/^(data:image\/|https?:\/\/)/i.test(value)) {
          var img = document.createElement('img');
          img.src = value;
          img.alt = 'QR';
          img.style.maxWidth = '100%';
          target.innerHTML = '';
          target.appendChild(img);
          return;
        }

        target.setAttribute('data-qr', value);
      })();
    </script>
  </body>
</html>`,
      { waitUntil: 'domcontentloaded' }
    );

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
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

module.exports = {
  getAckPDF,
};
