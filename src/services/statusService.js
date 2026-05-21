/**
 * Status service responsibility:
 * Handle status-related workflows for bot interactions.
 */

const CONFIG = require('../config/config');
const httpClient = require('../core/httpClient');
const { getSessionCookie } = require('../core/sessionManager');
const { renderHTML } = require('../core/puppeteerEngine');
const { getTempFilePath } = require('../core/tempFiles');
const cheerio = require('cheerio');
const fs = require('fs');
const aiParsingService = require('./aiParsingService');


function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

async function fetchStatusMarkup(appNo) {
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
    return {
      extractedHTML: extracted,
      wrappedHTML: buildStatusHTML(extracted),
    };
  } catch (error) {
    throw new Error(`Unable to fetch status markup: ${error.message}`);
  }
}

async function getStatusSnapshot(appNo, options = {}) {
  const { keepFile = false, filename = `Status_${appNo}.jpg` } = options;
  const { extractedHTML, wrappedHTML } = await fetchStatusMarkup(appNo);
  const filePath = getTempFilePath(filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await renderHTML(wrappedHTML, {
    type: 'image',
    path: filePath,
  });

  const buffer = fs.readFileSync(filePath);

  if (!keepFile) {
    fs.unlinkSync(filePath);
  }

  return {
    html: extractedHTML,
    filePath,
    buffer,
  };
}

async function getVisualStatus(appNo) {
  try {
    const snapshot = await getStatusSnapshot(appNo, {
      keepFile: true,
      filename: `Status_${appNo}.jpg`,
    });

    return snapshot.filePath;
  } catch (error) {
    throw new Error(`Unable to fetch visual status: ${error.message}`);
  }
}

function parseStatusDetails(html) {
  const $ = cheerio.load(html || '');
  const approvalKeywords = [
    'APPROVAL OF DL',
    'APPROVAL OF ENDORSEMENTS',
    'APPROVAL OF LL',
  ];
  const currentStatusRow = $('#covTable tr')
    .filter((_, el) => $(el).find('td').length > 0)
    .first();
  const transaction = normalizeText(currentStatusRow.find('td').eq(0).find('b').first().text());
  const stage = normalizeText(currentStatusRow.find('td').eq(1).find('b').first().text());
  const counter = normalizeText(currentStatusRow.find('td').eq(2).find('b').first().text());
  const stageUpper = stage.toUpperCase();
  const completedActions = [];
  const furtherActions = [];

  $('fieldset')
    .filter((_, el) =>
      normalizeText($(el).find('legend').first().text()).includes('Completed Action(s)')
    )
    .find('table tbody tr')
    .each((_, row) => {
      const cells = $(row).find('td');
      const actionName = normalizeText(cells.eq(0).text());
      const statusText = normalizeText(cells.eq(1).text());
      const processedOn = normalizeText(cells.eq(2).text());
      if (actionName) {
        completedActions.push({ actionName, status: statusText, processedOn });
      }
    });

  $('fieldset')
    .filter((_, el) =>
      normalizeText($(el).find('legend').first().text()).includes('Further Action(s)')
    )
    .find('table tbody tr')
    .each((_, row) => {
      const cells = $(row).find('td');
      const actionName = normalizeText(cells.eq(0).text());
      const statusText = normalizeText(cells.eq(1).text());
      if (actionName) {
        furtherActions.push({ actionName, status: statusText });
      }
    });

  const dispatchHeading = $('h3')
    .filter((_, el) => normalizeText($(el).text()).includes('Licence has been dispatched'))
    .first();

  if (dispatchHeading.length > 0) {
    const dlNumber = normalizeText(
      $('td')
        .filter((_, el) => normalizeText($(el).text()).includes('Driving Licence Number'))
        .first()
        .next('td')
        .find('b')
        .first()
        .text()
    );

    const dispatchTable = $('th')
      .filter((_, el) => normalizeText($(el).text()).includes('Speed Post Tracker No'))
      .first()
      .closest('table');
    const trackerNo = normalizeText(
      dispatchTable.find('tr').eq(1).find('td').eq(3).find('b').first().text()
    );

    return {
      kind: 'dispatched',
      dlNumber,
      trackerNo,
      message: normalizeText(dispatchHeading.text()),
      transaction,
      stage,
      counter,
      completedActions,
      furtherActions,
    };
  }

  const completedApprovalRow = $('fieldset')
    .filter((_, el) =>
      normalizeText($(el).find('legend').first().text()).includes('Completed Action(s)')
    )
    .find('table tbody tr')
    .filter((_, el) => {
      const actionName = normalizeText($(el).find('td').eq(0).find('b').first().text()).toUpperCase();
      const statusText = normalizeText($(el).find('td').eq(1).find('b').first().text()).toUpperCase();

      return approvalKeywords.some((keyword) => actionName.includes(keyword)) && statusText === 'COMPLETED';
    })
    .first();

  if (completedApprovalRow.length > 0) {
    return {
      kind: 'approved',
      approvedAction: normalizeText(completedApprovalRow.find('td').eq(0).find('b').first().text()),
      approvedOn: normalizeText(completedApprovalRow.find('td').eq(2).find('b').first().text()),
      transaction,
      stage,
      counter,
      completedActions,
      furtherActions,
    };
  }

  const pendingCounterHeading = $('h3')
    .filter((_, el) => normalizeText($(el).text()).toLowerCase().includes('not pending at your counter'))
    .first();

  if (pendingCounterHeading.length > 0) {
    return {
      kind: 'pending-counter',
      message: normalizeText(pendingCounterHeading.text()),
      transaction,
      stage,
      counter,
      completedActions,
      furtherActions,
    };
  }

  if (
    approvalKeywords.some((keyword) => stageUpper.includes(keyword))
  ) {
    return {
      kind: 'approval-stage',
      transaction,
      stage,
      counter,
      completedActions,
      furtherActions,
    };
  }

  const approvedHeading = $('h3')
    .filter((_, el) => /licen[cs]e\s+has\s+been\s+approved/i.test(normalizeText($(el).text())))
    .first();

  if (approvedHeading.length > 0) {
    return {
      kind: 'approved',
      message: normalizeText(approvedHeading.text()),
      transaction,
      stage,
      counter,
      completedActions,
      furtherActions,
    };
  }

  return {
    kind: 'pending',
    transaction,
    stage,
    counter,
    completedActions,
    furtherActions,
  };
}

async function parseStatusDetailsAsync(html) {
  const standardResult = parseStatusDetails(html);
  if (CONFIG.AI_PARSING.ENABLED) {
    const needsAi = !standardResult.transaction || !standardResult.stage || !standardResult.completedActions || standardResult.completedActions.length === 0;
    if (needsAi) {
      try {
        const aiResult = await aiParsingService.parseStatusPage(html, 'sarathi');
        if (aiResult) {
          return aiResult;
        }
      } catch (err) {
        console.error('[AI Parsing] Sarathi AI parsing failed, using standard:', err);
      }
    }
  }
  return standardResult;
}

module.exports = {
  getVisualStatus,
  getStatusSnapshot,
  fetchStatusMarkup,
  parseStatusDetails,
  parseStatusDetailsAsync,
};
