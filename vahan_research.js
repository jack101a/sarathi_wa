require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { renderHTML } = require('./src/core/puppeteerEngine');

const FORM_URL =
  'https://vahan.parivahan.gov.in/vahanservice/vahan/ui/appl_status/form_Know_Appl_Status.xhtml';
const CAPTCHA_PATH = path.join(process.cwd(), 'vahan_captcha.png');
const RESPONSE_PATH = path.join(process.cwd(), 'vahan_response.txt');
const DEBUG_LOG_PATH = path.join(process.cwd(), 'vahan_debug.log');
const STATUS_IMAGE_PATH = path.join(process.cwd(), 'vahan_status.jpg');
const TRACK_STORE_PATH = path.join(process.cwd(), 'vahan_tracked_applications.json');
const DEFAULT_APPLICATION_NUMBER = String(process.argv[2] || process.env.VAHAN_TEST_APP_NO || '').trim();
const TARGET_USER = String((process.env.AUTHORIZED_USERS || '').split(',')[0] || '').trim();
const SESSION_NAME = String(process.env.SESSION_NAME || 'default-session').trim();
const TRACK_INTERVAL_MS = Number(process.env.VAHAN_TRACK_INTERVAL_MS || 120000);

let activeSession = null;
let keepAliveTimer = null;
let trackTimer = null;
let requestInFlight = false;

function debugLog(message, extra) {
  const lines = [`[${new Date().toISOString()}] ${message}`];
  if (typeof extra !== 'undefined') {
    lines.push(typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  }
  fs.appendFileSync(DEBUG_LOG_PATH, `${lines.join('\n')}\n`);
}

function createHttpClient() {
  return wrapper(
    axios.create({
      jar: new CookieJar(),
      withCredentials: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      timeout: 60000,
    })
  );
}

function resolveUrl(baseUrl, maybeRelativeUrl) {
  return new URL(maybeRelativeUrl, baseUrl).toString();
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readTrackedApplications() {
  try {
    if (!fs.existsSync(TRACK_STORE_PATH)) {
      return [];
    }

    const raw = fs.readFileSync(TRACK_STORE_PATH, 'utf8');
    if (!raw.trim()) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => ({
      applicationNumber: normalizeText(item.applicationNumber),
      tag: normalizeText(item.tag),
      chatId: normalizeText(item.chatId),
      createdAt: item.createdAt || new Date().toISOString(),
      lastSnapshot: normalizeText(item.lastSnapshot),
    }));
  } catch (error) {
    debugLog('Failed to read tracked applications', { message: error.message });
    return [];
  }
}

function writeTrackedApplications(entries) {
  const safeEntries = entries.map((item) => ({
    applicationNumber: normalizeText(item.applicationNumber),
    tag: normalizeText(item.tag),
    chatId: normalizeText(item.chatId),
    createdAt: item.createdAt || new Date().toISOString(),
    lastSnapshot: normalizeText(item.lastSnapshot),
  }));

  const tempPath = `${TRACK_STORE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(safeEntries, null, 2), 'utf8');
  fs.renameSync(tempPath, TRACK_STORE_PATH);
  return safeEntries;
}

function addTrackedApplication(applicationNumber, tag, chatId) {
  const entries = readTrackedApplications();
  const normalizedApp = normalizeText(applicationNumber);
  const normalizedChatId = normalizeText(chatId);
  const normalizedTag = normalizeText(tag);

  const exists = entries.find(
    (item) => item.applicationNumber === normalizedApp && item.chatId === normalizedChatId
  );

  if (exists) {
    return { created: false, entries };
  }

  const next = [
    ...entries,
    {
      applicationNumber: normalizedApp,
      tag: normalizedTag,
      chatId: normalizedChatId,
      createdAt: new Date().toISOString(),
      lastSnapshot: '',
    },
  ];

  return {
    created: true,
    entries: writeTrackedApplications(next),
  };
}

function removeTrackedApplication(applicationNumber, chatId) {
  const entries = readTrackedApplications();
  const normalizedApp = normalizeText(applicationNumber);
  const normalizedChatId = normalizeText(chatId);
  const next = entries.filter(
    (item) => !(item.applicationNumber === normalizedApp && item.chatId === normalizedChatId)
  );
  const removed = next.length !== entries.length;

  if (removed) {
    writeTrackedApplications(next);
  }

  return {
    removed,
    entries: removed ? next : entries,
  };
}

function updateTrackedApplication(applicationNumber, chatId, updates = {}) {
  const entries = readTrackedApplications();
  const normalizedApp = normalizeText(applicationNumber);
  const normalizedChatId = normalizeText(chatId);
  let updated = false;

  const next = entries.map((item) => {
    if (item.applicationNumber === normalizedApp && item.chatId === normalizedChatId) {
      updated = true;
      return {
        ...item,
        ...updates,
        applicationNumber: item.applicationNumber,
        chatId: item.chatId,
        tag: typeof updates.tag === 'undefined' ? item.tag : normalizeText(updates.tag),
        lastSnapshot:
          typeof updates.lastSnapshot === 'undefined'
            ? item.lastSnapshot
            : normalizeText(updates.lastSnapshot),
      };
    }

    return item;
  });

  if (updated) {
    writeTrackedApplications(next);
  }

  return {
    updated,
    entries: updated ? next : entries,
  };
}

function listTrackedApplications(chatId) {
  return readTrackedApplications().filter((item) => item.chatId === normalizeText(chatId));
}

function parseIncomingCommand(text) {
  const normalized = normalizeText(text);

  if (/^list\s+track$/i.test(normalized)) {
    return { type: 'list-track' };
  }

  const addMatch = normalized.match(/^add\s+track\s+rc\s+([A-Z0-9]+)(?:\s*-\s*(.+))?$/i);
  if (addMatch) {
    return {
      type: 'add-track',
      applicationNumber: normalizeText(addMatch[1]),
      tag: normalizeText(addMatch[2]),
    };
  }

  const removeMatch = normalized.match(/^remove\s+track\s+rc\s+([A-Z0-9]+)$/i);
  if (removeMatch) {
    return {
      type: 'remove-track',
      applicationNumber: normalizeText(removeMatch[1]),
    };
  }

  if (/^stop$/i.test(normalized)) {
    return { type: 'stop' };
  }

  return {
    type: 'plain',
    value: normalized,
  };
}

function extractInitialState(html) {
  const $ = cheerio.load(html);
  const viewState =
    $('input[name="javax.faces.ViewState"]').attr('value') ||
    $('input[id="j_id1:javax.faces.ViewState:0"]').attr('value') ||
    '';

  const captchaInputName =
    $('input[id="vhn_cap:CaptchaID"]').attr('name') ||
    $('input[name="vhn_cap:CaptchaID"]').attr('name') ||
    'vhn_cap:CaptchaID';
  const radioFieldName =
    $('input[type="radio"][value="applno"]').attr('name') ||
    'j_idt394';

  const captchaImage =
    $('img[id*="CaptchaImage"]').attr('src') ||
    $('img[id*="captcha"][src]').attr('src') ||
    $('img[src*="Captcha"]').attr('src') ||
    $('img[src*="captcha"]').attr('src');

  if (!viewState) {
    throw new Error('javax.faces.ViewState not found on Vahan page.');
  }

  if (!captchaImage) {
    throw new Error('Captcha image URL not found on Vahan page.');
  }

  return {
    viewState,
    captchaInputName,
    radioFieldName,
    captchaImageUrl: resolveUrl(FORM_URL, captchaImage),
  };
}

async function downloadCaptcha(client, captchaImageUrl) {
  const response = await client.get(captchaImageUrl, {
    responseType: 'arraybuffer',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: FORM_URL,
    },
  });

  fs.writeFileSync(CAPTCHA_PATH, Buffer.from(response.data));
  return CAPTCHA_PATH;
}

async function initializeFetchSession(applicationNumber) {
  fs.writeFileSync(DEBUG_LOG_PATH, '');
  const httpClient = createHttpClient();
  debugLog('GET form page', { url: FORM_URL, applicationNumber });
  const response = await httpClient.get(FORM_URL);
  const state = extractInitialState(response.data);
  debugLog('Initial state extracted', {
    viewStatePrefix: state.viewState.slice(0, 48),
    captchaInputName: state.captchaInputName,
    radioFieldName: state.radioFieldName,
    captchaImageUrl: state.captchaImageUrl,
  });

  await downloadCaptcha(httpClient, state.captchaImageUrl);
  debugLog('Captcha downloaded', { captchaPath: CAPTCHA_PATH });

  activeSession = {
    httpClient,
    applicationNumber,
    viewState: state.viewState,
    captchaInputName: state.captchaInputName,
    radioFieldName: state.radioFieldName,
    waitingForCaptcha: true,
    submitted: false,
    authenticated: false,
    lastCaptchaText: '',
  };

  return activeSession;
}

function extractViewStateFromXml(xmlText, fallbackValue) {
  const $xml = cheerio.load(xmlText, { xmlMode: true });
  const updatedValue =
    $xml('update[id*="javax.faces.ViewState"]').first().text() ||
    '';

  return normalizeText(updatedValue) || fallbackValue;
}

async function blurCaptcha(captchaText) {
  if (!activeSession) {
    throw new Error('No active Vahan session found.');
  }

  const body = new URLSearchParams({
    formKnowapplstatus: 'formKnowapplstatus',
    [activeSession.radioFieldName]: 'applno',
    tf_entry: activeSession.applicationNumber,
    [activeSession.captchaInputName]: captchaText,
    'javax.faces.ViewState': activeSession.viewState,
    'javax.faces.source': activeSession.captchaInputName,
    'javax.faces.partial.event': 'blur',
    'javax.faces.partial.execute': activeSession.captchaInputName,
    'javax.faces.partial.render': activeSession.captchaInputName,
    CLIENT_BEHAVIOR_RENDERING_MODE: 'OBSTRUSIVE',
    'javax.faces.behavior.event': 'blur',
    'javax.faces.partial.ajax': 'true',
  });

  debugLog('POST captcha blur', {
    applicationNumber: activeSession.applicationNumber,
    captchaText,
    viewStatePrefix: activeSession.viewState.slice(0, 48),
    radioFieldName: activeSession.radioFieldName,
  });
  const response = await activeSession.httpClient.post(FORM_URL, body.toString(), {
    headers: {
      Accept: '*/*',
      'Accept-Language': 'en-GB,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      Pragma: 'no-cache',
      Referer: FORM_URL,
    },
  });

  const responseText = String(response.data);
  activeSession.viewState = extractViewStateFromXml(responseText, activeSession.viewState);
  debugLog('Captcha blur response', {
    nextViewStatePrefix: activeSession.viewState.slice(0, 48),
    responseSnippet: responseText.slice(0, 1200),
  });
  return responseText;
}

async function submitApplicationStatus(captchaText) {
  if (!activeSession) {
    throw new Error('No active Vahan session found.');
  }

  await blurCaptcha(captchaText);

  const body = new URLSearchParams({
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': 'btn_submit',
    'javax.faces.partial.execute': '@all',
    'javax.faces.partial.render': 'verify_rec tb_showStatus captchapanelid tb_appl_no_status_grv',
    btn_submit: 'btn_submit',
    formKnowapplstatus: 'formKnowapplstatus',
    [activeSession.radioFieldName]: 'applno',
    tf_entry: activeSession.applicationNumber,
    [activeSession.captchaInputName]: captchaText,
    'javax.faces.ViewState': activeSession.viewState,
  });

  debugLog('POST final submit', {
    applicationNumber: activeSession.applicationNumber,
    captchaText,
    viewStatePrefix: activeSession.viewState.slice(0, 48),
    radioFieldName: activeSession.radioFieldName,
  });
  const response = await activeSession.httpClient.post(FORM_URL, body.toString(), {
    headers: {
      Accept: 'application/xml, text/xml, */*; q=0.01',
      'Accept-Language': 'en-GB,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      Pragma: 'no-cache',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: FORM_URL,
    },
  });

  const responseText = String(response.data);
  fs.writeFileSync(RESPONSE_PATH, responseText, 'utf8');
  debugLog('Final submit response', {
    responseSnippet: responseText.slice(0, 2500),
  });
  activeSession.submitted = true;
  activeSession.waitingForCaptcha = false;
  activeSession.authenticated = true;
  activeSession.lastCaptchaText = captchaText;

  return responseText;
}

async function submitApplicationStatusWithActiveSession(applicationNumber) {
  if (!activeSession || !activeSession.authenticated) {
    throw new Error('No authenticated Vahan session available.');
  }

  activeSession.applicationNumber = applicationNumber;

  const body = new URLSearchParams({
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': 'btn_submit',
    'javax.faces.partial.execute': '@all',
    'javax.faces.partial.render': 'verify_rec tb_showStatus captchapanelid tb_appl_no_status_grv',
    btn_submit: 'btn_submit',
    formKnowapplstatus: 'formKnowapplstatus',
    [activeSession.radioFieldName]: 'applno',
    tf_entry: applicationNumber,
    [activeSession.captchaInputName]: activeSession.lastCaptchaText || '',
    'javax.faces.ViewState': activeSession.viewState,
  });

  debugLog('POST final submit with active authenticated session', {
    applicationNumber,
    viewStatePrefix: activeSession.viewState.slice(0, 48),
    radioFieldName: activeSession.radioFieldName,
  });

  const response = await activeSession.httpClient.post(FORM_URL, body.toString(), {
    headers: {
      Accept: 'application/xml, text/xml, */*; q=0.01',
      'Accept-Language': 'en-GB,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      Pragma: 'no-cache',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: FORM_URL,
    },
  });

  const responseText = String(response.data);
  fs.writeFileSync(RESPONSE_PATH, responseText, 'utf8');
  activeSession.viewState = extractViewStateFromXml(responseText, activeSession.viewState);
  debugLog('Authenticated-session submit response', {
    nextViewStatePrefix: activeSession.viewState.slice(0, 48),
    responseSnippet: responseText.slice(0, 2500),
  });
  return responseText;
}

function extractStatusFragment(xmlText) {
  const $xml = cheerio.load(xmlText, { xmlMode: true });
  return $xml('update[id="tb_showStatus"]').first().text() || '';
}

function isIgnoredTransaction(transactionPurpose) {
  const normalized = normalizeText(transactionPurpose).toUpperCase();
  return (
    normalized.includes('POSTAL FEE') ||
    normalized.includes('SMART CARD FEE') ||
    normalized.includes('MV TAX')
  );
}

function getRelevantRows(card) {
  return (card.rows || []).filter((row) => !isIgnoredTransaction(row.transactionPurpose));
}

function isMeaningfulValue(value) {
  const normalized = normalizeText(value).toUpperCase();
  return normalized && normalized !== 'NOT AVAILABLE';
}

function isApprovedCard(card) {
  const relevantRows = getRelevantRows(card);

  if (isMeaningfulValue(card.extra.rcPrintOrSmartCardStatus)) {
    return true;
  }

  if (isMeaningfulValue(card.extra.dispatchRcStatus)) {
    return true;
  }

  return relevantRows.some((row) => {
    const currentStatus = normalizeText(row.currentStatus).toUpperCase();
    return currentStatus.includes('COMPLETED') || currentStatus.includes('APPROVED ON');
  });
}

function buildTrackingSnapshot(card) {
  const relevantRows = getRelevantRows(card).map((row) => ({
    transactionPurpose: row.transactionPurpose,
    currentStatus: row.currentStatus,
  }));

  return JSON.stringify({
    relevantRows,
    rcPrintOrSmartCardStatus: card.extra.rcPrintOrSmartCardStatus,
    dispatchRcStatus: card.extra.dispatchRcStatus,
  });
}

function parseStatusCard(xmlText) {
  const fragment = extractStatusFragment(xmlText);
  if (!fragment) {
    return null;
  }

  const $ = cheerio.load(fragment);
  const heading = normalizeText($('h2').first().text());
  const headingMatch = heading.match(
    /Application Status for Application Number\s+(.+?)\s+dated\s+-\s+(.+?)\s+against vehicle no\s+-\s+(.+)/i
  );

  const rows = $('#tb_appl_no_status_data tr')
    .map((_, el) => {
      const cells = $(el).find('td');
      return {
        serial: normalizeText(cells.eq(0).text()),
        transactionPurpose: normalizeText(cells.eq(1).text()),
        authenticationType: normalizeText(cells.eq(2).text()),
        currentStatus: normalizeText(cells.eq(3).text()),
        portalName: normalizeText(cells.eq(5).text()),
      };
    })
    .get()
    .filter((row) => row.transactionPurpose || row.currentStatus);

  const detailCells = $('#tb_appl_no_status_detail_data tr').first().find('td');
  const extra = {
    hsrpStatus: normalizeText(detailCells.eq(0).text()),
    fcPrint: normalizeText(detailCells.eq(1).text()),
    rcPrintOrSmartCardStatus: normalizeText(detailCells.eq(2).text()),
    dispatchRcStatus: normalizeText(detailCells.eq(3).clone().children().remove().end().text()),
  };

  return {
    applicationNumber: headingMatch ? normalizeText(headingMatch[1]) : activeSession?.applicationNumber || '',
    applicationDate: headingMatch ? normalizeText(headingMatch[2]) : '',
    vehicleNumber: headingMatch ? normalizeText(headingMatch[3]) : '',
    rows,
    extra,
    heading,
  };
}

function buildStatusSummaryMessage(card) {
  const lines = [
    `Vehicle No: ${card.vehicleNumber || 'N/A'}`,
    `Application Date: ${card.applicationDate || 'N/A'}`,
  ];

  for (const row of getRelevantRows(card)) {
    lines.push(`${row.transactionPurpose}: ${row.currentStatus}`);
  }

  if (card.extra.rcPrintOrSmartCardStatus) {
    lines.push(`RC Print / SMART CARD Status: ${card.extra.rcPrintOrSmartCardStatus}`);
  }

  if (card.extra.dispatchRcStatus) {
    lines.push(`DISPATCH RC Status: ${card.extra.dispatchRcStatus}`);
  }

  return lines.join('\n');
}

function buildStatusSummaryHtml(card) {
  const rowsHtml = getRelevantRows(card)
    .map(
      (row) => `
        <tr>
          <td>${row.transactionPurpose || '-'}</td>
          <td>${row.currentStatus || '-'}</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: #eef4fb;
        color: #122033;
      }
      .card {
        width: 860px;
        margin: 20px auto;
        background: #ffffff;
        border: 1px solid #d7e3f2;
        border-radius: 14px;
        padding: 24px;
        box-shadow: 0 10px 30px rgba(16, 41, 77, 0.08);
      }
      h1 {
        margin: 0 0 14px;
        font-size: 28px;
      }
      .meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 16px;
        margin-bottom: 20px;
      }
      .meta div {
        padding: 10px 12px;
        background: #f5f8fc;
        border-radius: 10px;
        font-size: 15px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #d9e4f2;
        padding: 10px 12px;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #dce9f8;
      }
      .footer {
        margin-top: 18px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 16px;
      }
      .footer div {
        padding: 10px 12px;
        background: #f5f8fc;
        border-radius: 10px;
        font-size: 15px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Vahan Status</h1>
      <div class="meta">
        <div><strong>Vehicle No:</strong> ${card.vehicleNumber || 'N/A'}</div>
        <div><strong>Application Date:</strong> ${card.applicationDate || 'N/A'}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Current Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="2">No status rows found.</td></tr>'}
        </tbody>
      </table>
      <div class="footer">
        <div><strong>RC Print / SMART CARD Status:</strong> ${card.extra.rcPrintOrSmartCardStatus || 'N/A'}</div>
        <div><strong>DISPATCH RC Status:</strong> ${card.extra.dispatchRcStatus || 'N/A'}</div>
      </div>
    </div>
  </body>
</html>`;
}

async function renderStatusImage(card) {
  const html = buildStatusSummaryHtml(card);
  if (fs.existsSync(STATUS_IMAGE_PATH)) {
    fs.rmSync(STATUS_IMAGE_PATH, { force: true });
  }

  await renderHTML(html, {
    type: 'image',
    path: STATUS_IMAGE_PATH,
    imageOptions: {
      type: 'jpeg',
      quality: 90,
      fullPage: true,
    },
  });

  return STATUS_IMAGE_PATH;
}

function parseResponseSummary(xmlText) {
  const card = parseStatusCard(xmlText);
  if (card) {
    return {
      ok: true,
      message: buildStatusSummaryMessage(card),
      rawText: card.heading,
      card,
    };
  }

  const $xml = cheerio.load(xmlText, { xmlMode: true });
  const updateTexts = $xml('update')
    .map((_, el) => normalizeText($xml(el).text()))
    .get()
    .filter(Boolean);

  const joined = updateTexts.join(' ');

  const errorMatch = joined.match(/Verification Code is missing|Verification code does not match/i);
  if (errorMatch) {
    return {
      ok: false,
      message: errorMatch[0],
      rawText: joined,
    };
  }

  const htmlLikeUpdates = $xml('update')
    .map((_, el) => $xml(el).text())
    .get()
    .filter((value) => /<[^>]+>/.test(value));

  const statusUpdate = $xml('update[id="tb_showStatus"]').first().text();
  if (statusUpdate) {
    const $status = cheerio.load(statusUpdate);
    const statusText = normalizeText($status.text());
    if (statusText) {
      return {
        ok: true,
        message: statusText.slice(0, 1500),
        rawText: statusText,
      };
    }
  }

  const gridUpdate = $xml('update[id="tb_appl_no_status_grv"]').first().text();
  if (gridUpdate) {
    const $grid = cheerio.load(gridUpdate);
    const gridText = normalizeText($grid.text());
    if (gridText) {
      return {
        ok: true,
        message: gridText.slice(0, 1500),
        rawText: gridText,
      };
    }
  }

  for (const fragment of htmlLikeUpdates) {
    const $ = cheerio.load(fragment);
    const text = normalizeText($.text());
    if (!text) {
      continue;
    }

    if (/application status|current status|stage|pending|approved|dispatch|print/i.test(text)) {
      return {
        ok: true,
        message: text.slice(0, 1500),
        rawText: text,
      };
    }
  }

  return {
    ok: true,
    message: joined.slice(0, 1500) || 'Response received. Check vahan_response.txt for full details.',
    rawText: joined,
  };
}

async function sendWhatsappText(client, chatId, text) {
  await client.sendMessage(chatId, text);
}

async function sendWhatsappImage(client, chatId, imagePath, caption) {
  const media = MessageMedia.fromFilePath(imagePath);
  await client.sendMessage(chatId, media, { caption });
}

async function pollTrackedApplications(client, chatId) {
  if (!activeSession || !activeSession.authenticated || requestInFlight) {
    return;
  }

  const tracked = listTrackedApplications(chatId);
  if (tracked.length === 0) {
    return;
  }

  requestInFlight = true;

  try {
    for (const item of tracked) {
      const responseXml = await submitApplicationStatusWithActiveSession(item.applicationNumber);
      const summary = parseResponseSummary(responseXml);

      if (!summary.card) {
        continue;
      }

      const snapshot = buildTrackingSnapshot(summary.card);
      if (snapshot === (item.lastSnapshot || '')) {
        continue;
      }

      updateTrackedApplication(item.applicationNumber, chatId, { lastSnapshot: snapshot });

      if (!isApprovedCard(summary.card)) {
        continue;
      }

      const imagePath = await renderStatusImage(summary.card);
      await sendWhatsappImage(
        client,
        chatId,
        imagePath,
        `Vahan status: ${summary.card.vehicleNumber || item.applicationNumber}${item.tag ? ` - ${item.tag}` : ''}`
      );
      await sendWhatsappText(
        client,
        chatId,
        `Approved: ${item.tag || item.applicationNumber}`
      );
      removeTrackedApplication(item.applicationNumber, chatId);
    }
  } catch (error) {
    debugLog('Track polling error', { message: error.message, stack: error.stack });
  } finally {
    requestInFlight = false;
  }
}

async function sendCaptchaToWhatsapp(client, chatId, applicationNumber) {
  const media = MessageMedia.fromFilePath(CAPTCHA_PATH);
  await client.sendMessage(chatId, media, {
    caption: [
      'Vahan captcha fetched.',
      `Application: ${applicationNumber}`,
      'Reply in this chat with only the captcha text.',
    ].join('\n'),
  });
}

async function cleanup(client, exitCode = 0) {
  activeSession = null;

  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  if (trackTimer) {
    clearInterval(trackTimer);
    trackTimer = null;
  }

  if (client) {
    try {
      await client.destroy();
    } catch (error) {
      // Ignore cleanup errors on shutdown.
    }
  }

  process.exit(exitCode);
}

async function main() {
  if (!DEFAULT_APPLICATION_NUMBER) {
    throw new Error('Provide an application number as argv[2] or set VAHAN_TEST_APP_NO in .env.');
  }

  if (!TARGET_USER) {
    throw new Error('No target WhatsApp user found in AUTHORIZED_USERS.');
  }

  await initializeFetchSession(DEFAULT_APPLICATION_NUMBER);

  console.log(`Application number: ${DEFAULT_APPLICATION_NUMBER}`);
  console.log(`Captcha saved to: ${CAPTCHA_PATH}`);
  console.log(`Response output path: ${RESPONSE_PATH}`);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: SESSION_NAME,
    }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  const expectedChatId = `${TARGET_USER}@c.us`;

  client.on('ready', async () => {
    await sendCaptchaToWhatsapp(client, expectedChatId, DEFAULT_APPLICATION_NUMBER);
    debugLog('WhatsApp captcha sent', { expectedChatId, applicationNumber: DEFAULT_APPLICATION_NUMBER });
    console.log(`Captcha sent to WhatsApp: ${expectedChatId}`);
    console.log('Waiting for captcha reply...');
  });

  client.on('message', async (message) => {
    if (message.from !== expectedChatId || message.fromMe) {
      return;
    }

    const command = parseIncomingCommand(message.body);
    debugLog('WhatsApp message received', { from: message.from, command });

    if (!activeSession) {
      return;
    }

    if (command.type === 'list-track') {
      const tracked = listTrackedApplications(expectedChatId);
      if (tracked.length === 0) {
        await sendWhatsappText(client, expectedChatId, 'No Vahan applications are being tracked.');
        return;
      }

      await sendWhatsappText(
        client,
        expectedChatId,
        tracked
          .map((item, index) => `${index + 1}. ${item.applicationNumber}${item.tag ? ` - ${item.tag}` : ''}`)
          .join('\n')
      );
      return;
    }

    if (command.type === 'add-track') {
      const result = addTrackedApplication(command.applicationNumber, command.tag, expectedChatId);
      await sendWhatsappText(
        client,
        expectedChatId,
        result.created
          ? `Tracking added: ${command.applicationNumber}${command.tag ? ` - ${command.tag}` : ''}`
          : `Already tracking ${command.applicationNumber}`
      );
      return;
    }

    if (command.type === 'remove-track') {
      const result = removeTrackedApplication(command.applicationNumber, expectedChatId);
      await sendWhatsappText(
        client,
        expectedChatId,
        result.removed
          ? `Tracking removed: ${command.applicationNumber}`
          : `Tracking not found: ${command.applicationNumber}`
      );
      return;
    }

    if (command.type === 'stop') {
      await sendWhatsappText(client, expectedChatId, 'Stopping Vahan research session.');
      await cleanup(client, 0);
      return;
    }

    const incomingValue = command.type === 'plain' ? command.value : '';

    if (!incomingValue) {
      await sendWhatsappText(client, expectedChatId, 'Message was empty. Please send captcha, app number, or a tracking command.');
      return;
    }

    try {
      if (activeSession.waitingForCaptcha) {
        activeSession.waitingForCaptcha = false;
        await sendWhatsappText(client, expectedChatId, 'Submitting Vahan status request...');
        const responseXml = await submitApplicationStatus(incomingValue);
        const summary = parseResponseSummary(responseXml);
        debugLog('Parsed response summary', summary);

        if (summary.card) {
          const imagePath = await renderStatusImage(summary.card);
          await sendWhatsappImage(
            client,
            expectedChatId,
            imagePath,
            `Vahan status: ${summary.card.vehicleNumber || summary.card.applicationNumber || DEFAULT_APPLICATION_NUMBER}`
          );
        }

        await sendWhatsappText(
          client,
          expectedChatId,
          'Session authenticated. Send another application number, `add track rc <appno> -tag`, `list track`, or `stop`.'
        );

        console.log('Submission complete. Response sent to WhatsApp.');
        return;
      }

      if (activeSession.authenticated) {
        if (!/^[A-Z0-9]+$/i.test(incomingValue)) {
          await sendWhatsappText(
            client,
            expectedChatId,
            'Send another application number to test the authenticated session, or send stop.'
          );
          return;
        }

        await sendWhatsappText(client, expectedChatId, `Checking ${incomingValue} using current authenticated session...`);
        const responseXml = await submitApplicationStatusWithActiveSession(incomingValue);
        const summary = parseResponseSummary(responseXml);
        debugLog('Parsed response summary (authenticated session reuse)', summary);

        if (summary.card) {
          const imagePath = await renderStatusImage(summary.card);
          await sendWhatsappImage(
            client,
            expectedChatId,
            imagePath,
            `Vahan status: ${summary.card.vehicleNumber || summary.card.applicationNumber || incomingValue}`
          );
        }

        await sendWhatsappText(
          client,
          expectedChatId,
          'Ready for next application number. You can also use `add track rc <appno> -tag`, `list track`, or `stop`.'
        );
        return;
      }
    } catch (error) {
      debugLog('Submission error', { message: error.message, stack: error.stack });
      if (activeSession && !activeSession.authenticated) {
        activeSession.waitingForCaptcha = true;
      }
      await sendWhatsappText(
        client,
        expectedChatId,
        `Vahan submission failed: ${error.message}\nPlease reply with the captcha again if you want another try.`
      );
    }
  });

  client.on('qr', () => {
    console.error('QR required for WhatsApp session. Existing session may not be usable.');
  });

  client.on('auth_failure', async (message) => {
    console.error(`WhatsApp auth failure: ${message}`);
    await cleanup(client, 1);
  });

  client.on('disconnected', (reason) => {
    console.error(`WhatsApp disconnected: ${reason}`);
  });

  keepAliveTimer = setInterval(() => {
    if (activeSession && activeSession.waitingForCaptcha) {
      console.log('Still waiting for captcha reply...');
    }
  }, 30000);

  trackTimer = setInterval(() => {
    pollTrackedApplications(client, expectedChatId).catch((error) => {
      debugLog('Track timer failure', { message: error.message, stack: error.stack });
    });
  }, TRACK_INTERVAL_MS);

  await client.initialize();
}

main().catch((error) => {
  console.error(`Vahan research failed: ${error.message}`);
  process.exit(1);
});
