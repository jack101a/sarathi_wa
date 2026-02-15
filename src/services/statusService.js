/**
 * Status service responsibility:
 * Handle status-related workflows for bot interactions.
 */

const CONFIG = require('../config/config');
const httpClient = require('../core/httpClient');
const { getSessionCookie } = require('../core/sessionManager');
const { renderHTML } = require('../core/puppeteerEngine');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

function buildStatusHTML(content) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Status</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #f4f7fb;
        color: #222;
        font-family: Arial, sans-serif;
      }
      .sheet {
        width: 820px;
        margin: 20px auto;
        background: #fff;
        border: 1px solid #d9e2ee;
        border-radius: 10px;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
        padding: 24px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      td, th {
        border: 1px solid #e1e7f0;
        padding: 8px 10px;
        text-align: left;
        font-size: 14px;
      }
      th {
        background: #eef3fa;
      }
    </style>
  </head>
  <body>
    <div class="sheet">${content}</div>
  </body>
</html>`;
}

async function getVisualStatus(appNo) {
  if (!appNo) {
    throw new Error('Application number is required.');
  }

  try {
    if (!CONFIG.URLS.STATUS) {
      throw new Error('STATUS URL is not configured.');
    }

    const cookie = await getSessionCookie();
    const origin = CONFIG.URLS.HOME;
    const response = await httpClient.post(
      CONFIG.URLS.STATUS,
      new URLSearchParams({ papplno: appNo }).toString(),
      {
        headers: {
          Cookie: cookie,
          Origin: origin,
          Referer: origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const $ = cheerio.load(response.data || '');
    $('nav, header, footer, script, noscript').remove();
    $('td').filter((_, el) => $(el).text().includes('Note::')).remove();

    const extracted = $('form#applViewStages').html() || $('body').html() || '';
    const wrappedHTML = buildStatusHTML(extracted);
    const filename = `Status_${appNo}.jpg`;
    const filePath = path.join(process.cwd(), filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await renderHTML(wrappedHTML, {
      type: 'image',
      path: filePath,
    });

    return filePath;
  } catch (error) {
    throw new Error(`Unable to fetch visual status: ${error.message}`);
  }
}

module.exports = {
  getVisualStatus,
};
