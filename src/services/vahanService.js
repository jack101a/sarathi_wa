const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const CONFIG = require('../config/config');
const { renderHTML } = require('../core/puppeteerEngine');
const { getTempFilePath } = require('../core/tempFiles');
const aiParsingService = require('./aiParsingService');
const { solveCaptcha } = require('./vahanCaptchaSolver');
const {
  getTelegramNotificationTargets,
  sendTelegramMessage,
  sendTelegramPhoto,
  sendWhatsAppImage,
} = require('./chatNotifier');
const {
  addEntry,
  listEntries,
  readEntries,
  removeEntry,
  updateEntry,
} = require('./vahanTrackStore');

const FORM_URL =
  'https://vahan.parivahan.gov.in/vahanservice/vahan/ui/appl_status/form_Know_Appl_Status.xhtml';
const CAPTCHA_URL =
  'https://vahan.parivahan.gov.in/vahanservice/DispplayCaptcha?txtp_cd=2&bkgp_cd=0&noise_cd=0&gimp_cd=0&txtp_length=1&pfdrid_c=false?-863369176&pfdrid_c=true';
const VAHAN_TRACK_REFRESH_MS = 3 * 60 * 60 * 1000;
const VAHAN_HTTP_MAX_ATTEMPTS = 3;
const VAHAN_HTTP_RETRY_DELAY_MS = 1200;
const DEFAULT_CAPTCHA_RETRY_MIN_MS = 3 * 1000;
const DEFAULT_CAPTCHA_RETRY_MAX_MS = 5 * 1000;
const sessions = new Map();
let pollJob = null;
const activeClients = new Map();
let captchaSolver = solveCaptcha;
let httpClientFactory = createHttpClient;
let sleepFn = sleep;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTransport(value) {
  return normalizeText(value || 'whatsapp').toLowerCase() || 'whatsapp';
}

function getSessionKey(chatId, transport = 'whatsapp') {
  return `${normalizeTransport(transport)}:${normalizeText(chatId)}`;
}

function getActiveClient(transport = 'whatsapp') {
  return activeClients.get(normalizeTransport(transport)) || null;
}

function normalizeVehicleNo(value) {
  return normalizeText(value).replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function extractDate(value) {
  const text = normalizeText(value);
  const m1 = text.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (m1) {
    const mm = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    return `${String(Number(m1[1])).padStart(2, '0')}-${mm[m1[2].toUpperCase()] || '01'}-${m1[3]}`;
  }
  const m2 = text.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  return m2 ? `${m2[1]}-${m2[2]}-${m2[3]}` : '';
}

function buildVehicleValidationMessage(expectedVehicleNo, actualVehicleNo) {
  const expected = normalizeVehicleNo(expectedVehicleNo);
  if (!expected) {
    return '';
  }

  const actual = normalizeVehicleNo(actualVehicleNo);
  if (!actual) {
    return `Could not validate vehicle number. Expected: ${expectedVehicleNo}.`;
  }

  if (actual === expected) {
    return `Vehicle number validated: ${actualVehicleNo}.`;
  }

  return `Vehicle mismatch. Receipt vehicle: ${expectedVehicleNo}, Vahan returned: ${actualVehicleNo}.`;
}

function createHttpClient() {
  return wrapper(
    axios.create({
      jar: new CookieJar(),
      withCredentials: true,
      timeout: CONFIG.HTTP.TIMEOUT_MS,
      headers: {
        'User-Agent': CONFIG.HTTP.USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    })
  );
}

function isRetryableNetworkError(error) {
  const code = normalizeText(error && error.code).toUpperCase();
  const status = Number(error && error.response && error.response.status);

  return (
    ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code) ||
    [408, 429, 500, 502, 503, 504].includes(status)
  );
}

async function retryVahanHttpRequest(action) {
  let lastError = null;

  for (let attempt = 1; attempt <= VAHAN_HTTP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt >= VAHAN_HTTP_MAX_ATTEMPTS) {
        throw error;
      }

      await sleepFn(VAHAN_HTTP_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

function getUserFacingLookupError(error) {
  if (isRetryableNetworkError(error)) {
    return 'Could not reach the Vahan service right now. Please try again in a minute.';
  }

  return error && error.message
    ? error.message
    : 'Could not complete the Vahan request right now.';
}

async function sendTextMessage(client, chatId, text) {
  if (!client || typeof client.sendText !== 'function') {
    throw new Error('Transport client is not ready.');
  }

  await client.sendText(chatId, text);
}

async function sendImageFile(client, chatId, imagePath, caption) {
  if (!client || typeof client.sendImage !== 'function') {
    throw new Error('Transport client is not ready.');
  }

  await client.sendImage(chatId, imagePath, caption);
}

function getCaptchaAttemptCount() {
  return Math.max(1, Number(CONFIG.VAHAN_TRACK.CAPTCHA_MAX_ATTEMPTS) || 8);
}

function getCaptchaRetryRangeMs() {
  const minMs = Math.max(250, Number(CONFIG.VAHAN_TRACK.CAPTCHA_RETRY_MIN_MS) || DEFAULT_CAPTCHA_RETRY_MIN_MS);
  const maxMs = Math.max(minMs, Number(CONFIG.VAHAN_TRACK.CAPTCHA_RETRY_MAX_MS) || DEFAULT_CAPTCHA_RETRY_MAX_MS);

  return { minMs, maxMs };
}

function createFilePath(chatId, suffix) {
  const safeChatId = String(chatId || 'unknown').replace(/[^a-z0-9_-]/gi, '_');
  return getTempFilePath(`vahan_${safeChatId}_${suffix}`);
}

function cleanupFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
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

  if (!viewState) {
    throw new Error('Could not prepare the Vahan session right now.');
  }

  return {
    viewState,
    captchaInputName,
    radioFieldName,
  };
}

async function downloadCaptcha(session) {
  const response = await retryVahanHttpRequest(() =>
    session.httpClient.get(CAPTCHA_URL, {
      responseType: 'arraybuffer',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        Connection: 'keep-alive',
        Referer: FORM_URL,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-GPC': '1',
        'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    })
  );

  const filePath = createFilePath(session.chatId, 'captcha.png');
  fs.writeFileSync(filePath, Buffer.from(response.data));
  session.captchaPath = filePath;
  return filePath;
}

async function initializeSession(chatId, applicationNumber, transport = 'whatsapp', options = {}) {
  transport = normalizeTransport(transport);
  const sessionKey = getSessionKey(chatId, transport);
  const existing = sessions.get(sessionKey);
  if (existing) {
    cleanupFile(existing.captchaPath);
  }

  const httpClient = httpClientFactory();
  const response = await retryVahanHttpRequest(() => httpClient.get(FORM_URL));
  const initialState = extractInitialState(response.data);
  const session = {
    transport,
    chatId,
    httpClient,
    applicationNumber: normalizeText(applicationNumber),
    viewState: initialState.viewState,
    captchaInputName: initialState.captchaInputName,
    radioFieldName: initialState.radioFieldName,
    waitingForCaptcha: true,
    authenticated: false,
    lastCaptchaText: '',
    captchaRetryCount: 0,
    requestInFlight: false,
    expectedVehicleNo: normalizeText(options.expectedVehicleNo || ''),
  };

  await downloadCaptcha(session);
  sessions.set(sessionKey, session);
  return session;
}

function extractViewStateFromXml(xmlText, fallbackValue) {
  const $xml = cheerio.load(xmlText, { xmlMode: true });
  const nextValue = $xml('update[id*="javax.faces.ViewState"]').first().text() || '';
  return normalizeText(nextValue) || fallbackValue;
}

async function blurCaptcha(session, captchaText) {
  const body = new URLSearchParams({
    formKnowapplstatus: 'formKnowapplstatus',
    [session.radioFieldName]: 'applno',
    tf_entry: session.applicationNumber,
    [session.captchaInputName]: captchaText,
    'javax.faces.ViewState': session.viewState,
    'javax.faces.source': session.captchaInputName,
    'javax.faces.partial.event': 'blur',
    'javax.faces.partial.execute': session.captchaInputName,
    'javax.faces.partial.render': session.captchaInputName,
    CLIENT_BEHAVIOR_RENDERING_MODE: 'OBSTRUSIVE',
    'javax.faces.behavior.event': 'blur',
    'javax.faces.partial.ajax': 'true',
  });

  const response = await retryVahanHttpRequest(() =>
    session.httpClient.post(FORM_URL, body.toString(), {
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en-GB,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Faces-Request': 'partial/ajax',
        Pragma: 'no-cache',
        Referer: FORM_URL,
      },
    })
  );

  session.viewState = extractViewStateFromXml(String(response.data), session.viewState);
}

async function submitWithCaptcha(session, captchaText) {
  await blurCaptcha(session, captchaText);

  const body = new URLSearchParams({
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': 'btn_submit',
    'javax.faces.partial.execute': '@all',
    'javax.faces.partial.render': 'verify_rec tb_showStatus captchapanelid tb_appl_no_status_grv',
    btn_submit: 'btn_submit',
    formKnowapplstatus: 'formKnowapplstatus',
    [session.radioFieldName]: 'applno',
    tf_entry: session.applicationNumber,
    [session.captchaInputName]: captchaText,
    'javax.faces.ViewState': session.viewState,
  });

  const response = await retryVahanHttpRequest(() =>
    session.httpClient.post(FORM_URL, body.toString(), {
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
    })
  );

  session.authenticated = true;
  session.waitingForCaptcha = false;
  session.lastCaptchaText = captchaText;
  session.viewState = extractViewStateFromXml(String(response.data), session.viewState);
  return String(response.data);
}

async function submitWithAuthenticatedSession(session, applicationNumber) {
  session.applicationNumber = normalizeText(applicationNumber);

  const body = new URLSearchParams({
    'javax.faces.partial.ajax': 'true',
    'javax.faces.source': 'btn_submit',
    'javax.faces.partial.execute': '@all',
    'javax.faces.partial.render': 'verify_rec tb_showStatus captchapanelid tb_appl_no_status_grv',
    btn_submit: 'btn_submit',
    formKnowapplstatus: 'formKnowapplstatus',
    [session.radioFieldName]: 'applno',
    tf_entry: session.applicationNumber,
    [session.captchaInputName]: session.lastCaptchaText || '',
    'javax.faces.ViewState': session.viewState,
  });

  const response = await retryVahanHttpRequest(() =>
    session.httpClient.post(FORM_URL, body.toString(), {
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
    })
  );

  session.viewState = extractViewStateFromXml(String(response.data), session.viewState);
  return String(response.data);
}

function extractStatusFragment(xmlText) {
  const $xml = cheerio.load(xmlText, { xmlMode: true });
  return $xml('update[id="tb_showStatus"]').first().text() || '';
}

function extractStatusGridFragment(xmlText) {
  const $xml = cheerio.load(xmlText, { xmlMode: true });
  return $xml('update[id="tb_appl_no_status_grv"]').first().text() || '';
}

function parseStatusCard(xmlText, fallbackApplicationNumber) {
  const fragment = [extractStatusFragment(xmlText), extractStatusGridFragment(xmlText)]
    .filter(Boolean)
    .join('\n');
  if (!fragment) {
    return null;
  }

  const $ = cheerio.load(fragment);
  const heading = normalizeText($('h2').first().text());
  const headingMatch = heading.match(
    /Application Status for Application Number\s+(.+?)\s+dated\s+-\s+(.+?)\s+against vehicle no\s+-\s+(.+)/i
  );

  let rows = $('#tb_appl_no_status_data tr, table tbody[id="tb_appl_no_status_data"] tr')
    .map((_, element) => {
      const cells = $(element).find('td');
      const cellCount = cells.length;
      let transactionPurpose = '';
      let currentStatus = '';

      // Vahan responses appear in two layouts:
      // - 4 columns: [sr, transaction, ..., status]
      // - 2 columns: [transaction, status]
      if (cellCount >= 4) {
        transactionPurpose = normalizeText(cells.eq(1).text());
        currentStatus = normalizeText(cells.eq(3).text());
      } else if (cellCount >= 2) {
        transactionPurpose = normalizeText(cells.eq(0).text());
        currentStatus = normalizeText(cells.eq(1).text());
      } else if (cellCount === 1) {
        transactionPurpose = normalizeText(cells.eq(0).text());
      }

      return {
        transactionPurpose,
        currentStatus,
      };
    })
    .get()
    .filter((row) => row.transactionPurpose || row.currentStatus);

  if (rows.length === 0) {
    rows = $('table tr')
      .map((_, element) => {
        const cells = $(element).find('td');
        if (cells.length < 2) {
          return null;
        }

        const values = cells
          .toArray()
          .map((cell) => normalizeText($(cell).text()))
          .filter(Boolean);
        if (values.length < 2) {
          return null;
        }

        const statusIndex = values.findIndex((value) => /APPROVED|COMPLETED|PENDING|SCRUTINY|SUCCESS/i.test(value));
        let currentStatus = '';
        let transactionPurpose = '';
        if (statusIndex >= 0) {
          currentStatus = values[statusIndex];
          transactionPurpose = values.find((_, index) => index !== statusIndex) || '';
        } else {
          // Generic 2-column fallback: first cell is transaction, second is current status.
          transactionPurpose = values[0] || '';
          currentStatus = values[1] || '';
        }
        if (!transactionPurpose || !currentStatus) {
          return null;
        }
        if (/^NOT AVAILABLE$/i.test(transactionPurpose)) {
          return null;
        }
        if (/^TRANSACTION$/i.test(transactionPurpose) || /^CURRENT STATUS$/i.test(currentStatus)) {
          return null;
        }

        return {
          transactionPurpose,
          currentStatus,
        };
      })
      .get()
      .filter(Boolean);
  }

  const detailCells = $('#tb_appl_no_status_detail_data tr, table tbody[id="tb_appl_no_status_detail_data"] tr')
    .first()
    .find('td');

  const card = {
    applicationNumber: headingMatch ? normalizeText(headingMatch[1]) : normalizeText(fallbackApplicationNumber),
    applicationDate: headingMatch ? normalizeText(headingMatch[2]) : '',
    vehicleNumber: headingMatch ? normalizeText(headingMatch[3]) : '',
    rows,
    extra: {
      rcPrintOrSmartCardStatus: normalizeText(detailCells.eq(2).text()),
      dispatchRcStatus: normalizeText(detailCells.eq(3).clone().children().remove().end().text()),
    },
  };

  if (!card.vehicleNumber && !card.applicationDate && card.rows.length === 0) {
    return null;
  }

  return card;
}

async function parseStatusCardAsync(xmlText, fallbackApplicationNumber) {
  const standardResult = parseStatusCard(xmlText, fallbackApplicationNumber);

  if (CONFIG.AI_PARSING.ENABLED) {
    const needsAi = !standardResult || !standardResult.vehicleNumber || !standardResult.rows || standardResult.rows.length === 0;
    if (needsAi) {
      const text = String(xmlText || '').toUpperCase();
      const hasStatusIndicators = text.includes('APPLICATION STATUS') || text.includes('SHOWSTATUS') || text.includes('STATUS') || text.includes('TB_APPL_NO_STATUS');
      const isError = text.includes('VERIFICATION CODE') || text.includes('SESSION EXPIRED') || text.includes('EXPIRED');

      if (hasStatusIndicators && !isError) {
        try {
          const aiResult = await aiParsingService.parseStatusPage(xmlText, 'vahan');
          if (aiResult) {
            return aiResult;
          }
        } catch (err) {
          console.error('[AI Parsing] Vahan AI parsing failed, using standard:', err);
        }
      }
    }
  }
  return standardResult;
}

function isIgnoredTransaction(transactionPurpose) {
  const text = normalizeText(transactionPurpose).toUpperCase();
  return /(^|\s|\/)(POSTAL\s+)?FEE(\s|\/|$)/.test(text)
    || text.includes('SMART CARD FEE');
}

function getRelevantRows(card) {
  return (card.rows || []).filter((row) => !isIgnoredTransaction(row.transactionPurpose));
}

function getDisplayRows(card) {
  return Array.isArray(card.rows) ? card.rows : [];
}

function isMeaningfulValue(value) {
  const text = normalizeText(value).toUpperCase();
  return Boolean(text) && text !== 'NOT AVAILABLE';
}

function isDispatchRcGenerated(value) {
  return normalizeText(value).toUpperCase().includes('DISPATCH RC GENERATED');
}

function classifyVahanStatus(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) {
    return { status: '', date: '' };
  }

  const date = extractDate(text);
  if (text.includes('PENDING')) {
    return { status: 'Pending', date };
  }
  if (text.includes('SCRUTINY')) {
    return { status: 'Scrutiny', date };
  }
  if (text.includes('APPROVED')) {
    return { status: 'Approved', date };
  }
  if (text.includes('COMPLETED') || text.includes('SUCCESS')) {
    return { status: 'Completed', date };
  }

  return { status: '', date };
}

function isDispatchedCard(card) {
  return isDispatchRcGenerated(card && card.extra && card.extra.dispatchRcStatus);
}

function buildTrackingSnapshot(card) {
  return JSON.stringify({
    rows: getRelevantRows(card).map((row) => ({
      transactionPurpose: normalizeText(row.transactionPurpose),
      currentStatus: normalizeText(row.currentStatus),
    })),
    rcPrintOrSmartCardStatus: normalizeText(card.extra.rcPrintOrSmartCardStatus),
    dispatchRcStatus: normalizeText(card.extra.dispatchRcStatus),
  });
}

function deriveVahanTimeline(card) {
  const relevantRows = getRelevantRows(card);
  const serviceNames = relevantRows
    .map((r) => normalizeText(r.transactionPurpose))
    .filter((name) => {
      const t = name.toUpperCase();
      return t && !isIgnoredTransaction(t);
    });

  const statusDates = relevantRows
    .map((r) => extractDate(r.currentStatus))
    .filter(Boolean);
  const parsedStatuses = relevantRows.map((r) => classifyVahanStatus(r.currentStatus));
  const approvedStatusDate = relevantRows
    .map((r, index) => ({ row: r, parsed: parsedStatuses[index] }))
    .filter(({ parsed }) => parsed.status === 'Completed' || parsed.status === 'Approved')
    .map(({ parsed }) => parsed.date)
    .find(Boolean) || '';
  const firstStatusDate = statusDates[0] || '';
  const rcPrintDate = isMeaningfulValue(card.extra.rcPrintOrSmartCardStatus)
    ? extractDate(card.extra.rcPrintOrSmartCardStatus)
    : '';
  const approvalDate = approvedStatusDate || rcPrintDate;
  const dispatchDate = isDispatchRcGenerated(card.extra.dispatchRcStatus)
    ? extractDate(card.extra.dispatchRcStatus)
    : '';

  return {
    serviceName: serviceNames.join(', '),
    applicationDate: normalizeText(card.applicationDate),
    vehicleNo: normalizeText(card.vehicleNumber),
    scrutinyAt: firstStatusDate || approvalDate,
    approvalAt: approvalDate,
    dispatchedAt: dispatchDate,
  };
}

function updateTrackedCardMetadata(chatId, transport, card) {
  if (!card || !card.applicationNumber) {
    return { updated: false };
  }

  const snapshot = buildTrackingSnapshot(card);
  return updateEntry({
    transport: normalizeTransport(transport),
    chatId,
    applicationNumber: card.applicationNumber,
    updates: {
      lastSnapshot: snapshot,
      lastCheckedAt: new Date().toISOString(),
      ...deriveVahanTimeline(card),
    },
  });
}

function getVahanUpdateChatId() {
  return String(CONFIG.VAHAN_TRACK.UPDATE_CHAT_ID || '').trim();
}

async function sendTrackedUpdate(item, card) {
  const transport = normalizeTransport(item.transport);
  const targetChatId =
    transport === 'whatsapp'
      ? getVahanUpdateChatId()
      : normalizeText(item.chatId);
  if (!targetChatId) {
    return false;
  }
  const imagePath = await renderStatusImage(card, targetChatId);

  try {
    const buffer = fs.readFileSync(imagePath);
    if (transport === 'telegram') {
      await sendTelegramPhoto(
        targetChatId,
        buffer,
        path.basename(imagePath),
        `Vahan status: ${card.vehicleNumber || item.applicationNumber}`
      );
    } else {
      await sendWhatsAppImage(
        targetChatId,
        buffer,
        path.basename(imagePath),
        `Vahan status: ${card.vehicleNumber || item.applicationNumber}`
      );
    }
  } finally {
    cleanupFile(imagePath);
  }

  return true;
}

function buildStatusSummaryHtml(card) {
  const rowsHtml = getDisplayRows(card)
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
      body { margin: 0; font-family: Arial, sans-serif; background: #eef4fb; color: #122033; }
      .card { width: 860px; margin: 20px auto; background: #fff; border: 1px solid #d7e3f2; border-radius: 14px; padding: 24px; box-shadow: 0 10px 30px rgba(16, 41, 77, 0.08); }
      h1 { margin: 0 0 14px; font-size: 28px; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-bottom: 20px; }
      .meta div, .footer div { padding: 10px 12px; background: #f5f8fc; border-radius: 10px; font-size: 15px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #d9e4f2; padding: 10px 12px; text-align: left; vertical-align: top; }
      th { background: #dce9f8; }
      .footer { margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Vahan Status</h1>
      <div class="meta">
        <div><strong>Vehicle No:</strong> ${card.vehicleNumber || 'N/A'}</div>
        <div><strong>Application Date:</strong> ${card.applicationDate || 'N/A'}</div>
      </div>
      <h2 style="margin: 0 0 12px; font-size: 20px;">Current Status</h2>
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Current Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="2">Status rows not available in this response.</td></tr>'}
        </tbody>
      </table>
      <div class="footer">
        <div><strong>RC Print / SMART CARD Status:</strong> ${card.extra.rcPrintOrSmartCardStatus || 'Not Available'}</div>
        <div><strong>DISPATCH RC Status:</strong> ${card.extra.dispatchRcStatus || 'Not Available'}</div>
      </div>
    </div>
  </body>
</html>`;
}

async function renderStatusImage(card, chatId) {
  const imagePath = createFilePath(chatId, 'status.jpg');
  cleanupFile(imagePath);
  await renderHTML(buildStatusSummaryHtml(card), {
    type: 'image',
    path: imagePath,
    imageOptions: {
      type: 'jpeg',
      quality: 90,
      fullPage: true,
    },
  });
  return imagePath;
}

async function isSessionExpiredResponse(xmlText, fallbackApplicationNumber) {
  const text = normalizeText(xmlText).toUpperCase();
  if (!text) {
    return true;
  }

  if (text.includes('VERIFICATION CODE IS MISSING') || text.includes('VERIFICATION CODE DOES NOT MATCH')) {
    return true;
  }

  const card = await parseStatusCardAsync(xmlText, fallbackApplicationNumber);
  return !card;
}

function isCaptchaRejectedResponse(xmlText) {
  const text = normalizeText(xmlText).toUpperCase();
  return text.includes('VERIFICATION CODE IS MISSING') || text.includes('VERIFICATION CODE DOES NOT MATCH');
}

function getHelpText() {
  return [
    'Available Vahan commands:',
    'track DL <appl_no> <DOB>',
    'track RC <appl_no>',
    'track status',
    'track add <appl_no> <DOB>',
    'track add <appl_no>',
    'track remove <appl_no>',
    'appl <appl_no> <DOB>',
    'form1 <appl_no> <DOB>',
    'form1a <appl_no> <DOB>',
    'form2 <appl_no> <DOB>',
    'formset <appl_no> <DOB>',
    'resend <appl_no> <DOB>',
    'alive',
    'suno',
    'help',
    'stop',
  ].join('\n');
}

function getSession(chatId) {
  return getSessionByTransport(chatId);
}

function getSessionByTransport(chatId, transport = 'whatsapp') {
  return sessions.get(getSessionKey(chatId, transport)) || null;
}

function hasActiveSession(chatId, transport = 'whatsapp') {
  return Boolean(getSessionByTransport(chatId, transport));
}

async function solveAndSubmitCaptcha(session) {
  if (!session.captchaPath || !fs.existsSync(session.captchaPath)) {
    await downloadCaptcha(session);
  }

  try {
    const captchaBuffer = fs.readFileSync(session.captchaPath);
    const captchaText = await captchaSolver(captchaBuffer);
    const xmlText = await submitWithCaptcha(session, captchaText);
    return {
      captchaText,
      xmlText,
    };
  } finally {
    cleanupFile(session.captchaPath);
    session.captchaPath = '';
  }
}

async function sendTelegramCaptchaFallback(session, caption) {
  const targets = getTelegramNotificationTargets();
  if (targets.length === 0) {
    return;
  }

  const buffer = fs.readFileSync(session.captchaPath);
  const filename = path.basename(session.captchaPath);
  const outcomes = await Promise.allSettled(
    targets.map(async (chatId) => {
      await sendTelegramPhoto(chatId, buffer, filename, caption, 'image/png');
      await sendTelegramMessage(
        chatId,
        [
          'Reply in WhatsApp with only the captcha text.',
          `Application: ${session.applicationNumber}`,
        ].join('\n')
      );
    })
  );

  for (const result of outcomes) {
    if (result.status === 'rejected') {
      console.error(`Telegram captcha fallback failed: ${result.reason.message}`);
    }
  }
}

async function sendMirrorTelegramCaptchaFallback(session, caption) {
  if (session.transport !== 'whatsapp') {
    return;
  }

  await sendTelegramCaptchaFallback(session, caption);
}

async function sendManualCaptchaFallback(client, session, reasonText) {
  session.waitingForCaptcha = true;
  session.authenticated = false;
  session.captchaRetryCount = 0;

  if (!session.captchaPath || !fs.existsSync(session.captchaPath)) {
    await downloadCaptcha(session);
  }

  const caption = [
    reasonText,
    `Application: ${session.applicationNumber}`,
    'Reply with only the captcha text.',
  ].join('\n');

  try {
    await sendImageFile(client, session.chatId, session.captchaPath, caption);
    await sendMirrorTelegramCaptchaFallback(session, caption);
  } finally {
    cleanupFile(session.captchaPath);
    session.captchaPath = '';
  }
}

async function attemptAutomatedLookup(client, session, options = {}) {
  const sendStatusImage = options.sendStatusImage !== false;
  const maxAttempts = getCaptchaAttemptCount();
  const retryRange = getCaptchaRetryRangeMs();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { xmlText } = await solveAndSubmitCaptcha(session);
      if (isCaptchaRejectedResponse(xmlText)) {
        session.waitingForCaptcha = true;
        session.authenticated = false;
        session.captchaRetryCount = attempt;
      } else {
        const card = await parseStatusCardAsync(xmlText, session.applicationNumber);
        if (!card) {
          throw new Error('The Vahan response did not contain a status card.');
        }

        if (sendStatusImage) {
          const imagePath = await renderStatusImage(card, session.chatId);
          await sendImageFile(client, session.chatId, imagePath, `Vahan status: ${card.vehicleNumber || card.applicationNumber}`);
          cleanupFile(imagePath);
        }
        updateTrackedCardMetadata(session.chatId, session.transport, card);
        const vehicleValidationMessage = buildVehicleValidationMessage(
          session.expectedVehicleNo,
          card.vehicleNumber
        );
        if (vehicleValidationMessage) {
          await sendTextMessage(client, session.chatId, vehicleValidationMessage);
        }

        session.authenticated = true;
        session.waitingForCaptcha = false;
        session.captchaRetryCount = 0;
        return true;
      }
    } catch (error) {
      cleanupFile(session.captchaPath);
      session.captchaPath = '';
      if (attempt >= maxAttempts) {
        throw error;
      }
    }

    if (attempt < maxAttempts) {
      await sleepFn(randomBetween(retryRange.minMs, retryRange.maxMs));
    }
  }

  return false;
}

async function startLookup(client, chatId, applicationNumber, transport = 'whatsapp', options = {}) {
  transport = normalizeTransport(transport);
  const existing = getSessionByTransport(chatId, transport);
  const expectedVehicleNo = normalizeText(options.expectedVehicleNo || '');
  const sendStatusImage = options.sendStatusImage !== false;
  if (existing && existing.authenticated) {
    try {
      existing.expectedVehicleNo = expectedVehicleNo;
      const xmlText = await submitWithAuthenticatedSession(existing, applicationNumber);
      if (!(await isSessionExpiredResponse(xmlText, applicationNumber))) {
        const card = await parseStatusCardAsync(xmlText, applicationNumber);
        if (sendStatusImage) {
          const imagePath = await renderStatusImage(card, chatId);
          await sendImageFile(client, chatId, imagePath, `Vahan status: ${card.vehicleNumber || card.applicationNumber}`);
          cleanupFile(imagePath);
        }
        updateTrackedCardMetadata(chatId, transport, card);
        const vehicleValidationMessage = buildVehicleValidationMessage(expectedVehicleNo, card.vehicleNumber);
        if (vehicleValidationMessage) {
          await sendTextMessage(client, chatId, vehicleValidationMessage);
        }
        return;
      }
    } catch (error) {
      // Fall through to fresh captcha bootstrap when the session stops being usable.
    }
  }

  let session;
  try {
    session = await initializeSession(chatId, applicationNumber, transport, {
      expectedVehicleNo,
    });
  } catch (error) {
    await sendTextMessage(client, chatId, `Vahan request failed: ${getUserFacingLookupError(error)}`);
    return;
  }
  if (CONFIG.VAHAN_TRACK.CAPTCHA_AUTO_SOLVE) {
    try {
      const solved = await attemptAutomatedLookup(client, session, { sendStatusImage });
      if (solved) {
        return;
      }
    } catch (error) {
      session.waitingForCaptcha = true;
      session.authenticated = false;
    }
  }

  await sendManualCaptchaFallback(
    client,
    session,
    CONFIG.VAHAN_TRACK.CAPTCHA_AUTO_SOLVE
      ? 'Automatic captcha solving failed. Please solve it manually.'
      : 'Vahan captcha fetched.'
  );
}

async function stopSession(chatId, transport = 'whatsapp') {
  transport = normalizeTransport(transport);
  const sessionKey = getSessionKey(chatId, transport);
  const session = sessions.get(sessionKey);
  if (!session) {
    return false;
  }

  cleanupFile(session.captchaPath);
  sessions.delete(sessionKey);
  return true;
}

async function handleIncomingText(client, chatId, text, transport = 'whatsapp') {
  transport = normalizeTransport(transport);
  const session = getSessionByTransport(chatId, transport);
  if (!session) {
    return false;
  }

  const value = normalizeText(text);
  if (!value) {
    if (session.authenticated) {
      return true;
    }

    await sendTextMessage(client, chatId, 'Send the captcha text or another Vahan application number.');
    return true;
  }

  if (session.requestInFlight) {
    await sendTextMessage(client, chatId, 'One Vahan request is already running. Please wait a moment.');
    return true;
  }

  session.requestInFlight = true;

  try {
    let xmlText;
    const attemptedCaptcha = session.waitingForCaptcha;
    if (session.waitingForCaptcha) {
      xmlText = await submitWithCaptcha(session, value.toLowerCase());
    } else if (session.authenticated && /^[A-Z0-9]+$/i.test(value)) {
      session.expectedVehicleNo = '';
      xmlText = await submitWithAuthenticatedSession(session, value);
    } else {
      if (session.authenticated) {
        // Ignore unrelated chat messages once a Vahan session is authenticated.
        return true;
      }

      await sendTextMessage(client, chatId, 'Send another Vahan application number, `add track rc <appno> -tag`, `list track`, or `stop`.');
      return true;
    }

    if (attemptedCaptcha && isCaptchaRejectedResponse(xmlText)) {
      if (session.captchaRetryCount < 1) {
        session.captchaRetryCount += 1;
        session.waitingForCaptcha = true;
        session.authenticated = false;
        await downloadCaptcha(session);
        await sendImageFile(
          client,
          chatId,
          session.captchaPath,
          [
            'Captcha did not match. Please try once more.',
            `Application: ${session.applicationNumber}`,
            'Reply with only the captcha text.',
          ].join('\n')
        );
        cleanupFile(session.captchaPath);
        return true;
      }

      await stopSession(chatId, transport);
      await sendTextMessage(client, chatId, 'Captcha failed twice. Send `track rc <appl_no>` for a fresh Vahan session.');
      return true;
    }

    const card = await parseStatusCardAsync(xmlText, session.applicationNumber);
    if (!card) {
      await stopSession(chatId, transport);
      await sendTextMessage(client, chatId, 'The Vahan captcha session looks expired. Send `track rc <appl_no>` again for a fresh captcha.');
      return true;
    }

    const imagePath = await renderStatusImage(card, chatId);
    await sendImageFile(client, chatId, imagePath, `Vahan status: ${card.vehicleNumber || card.applicationNumber}`);
    cleanupFile(imagePath);
    updateTrackedCardMetadata(chatId, transport, card);
    const vehicleValidationMessage = buildVehicleValidationMessage(
      session.expectedVehicleNo,
      card.vehicleNumber
    );
    if (vehicleValidationMessage) {
      await sendTextMessage(client, chatId, vehicleValidationMessage);
    }

    session.authenticated = true;
    session.waitingForCaptcha = false;
    session.captchaRetryCount = 0;
    return true;
  } catch (error) {
    if (session) {
      session.waitingForCaptcha = !session.authenticated;
    }
    await sendTextMessage(client, chatId, `Vahan request failed: ${error.message}`);
    return true;
  } finally {
    session.requestInFlight = false;
  }
}

async function addTrack(chatId, applicationNumber, tag, transport = 'whatsapp', options = {}) {
  const { enforceTrackingLimit } = require('./trackingControlService');
  const hasSpace = await enforceTrackingLimit(chatId);
  if (!hasSpace) {
    return { created: false, error: 'LIMIT_REACHED' };
  }

  return addEntry({
    transport: normalizeTransport(transport),
    chatId,
    applicationNumber,
    tag,
    vehicleNo: options.vehicleNo || '',
    applicantName: options.applicantName || tag || '',
  });
}

function removeTrack(chatId, applicationNumber, transport = 'whatsapp') {
  return removeEntry({
    transport: normalizeTransport(transport),
    chatId,
    applicationNumber,
  });
}

function listTrack(chatId, transport = 'whatsapp') {
  return listEntries(normalizeTransport(transport), chatId);
}

async function pollTrackedApplications() {
  if (activeClients.size === 0) {
    return;
  }

  const entries = readEntries();
  for (const item of entries) {
    const lastCheckedAtMs = item.lastCheckedAt ? Date.parse(item.lastCheckedAt) : 0;
    const now = Date.now();
    if (lastCheckedAtMs && now - lastCheckedAtMs < VAHAN_TRACK_REFRESH_MS) {
      continue;
    }

    const session = getSessionByTransport(item.chatId, item.transport);
    if (!session || !session.authenticated || session.requestInFlight) {
      continue;
    }

    session.requestInFlight = true;
    try {
      const xmlText = await submitWithAuthenticatedSession(session, item.applicationNumber);
      if (await isSessionExpiredResponse(xmlText, item.applicationNumber)) {
        sessions.delete(getSessionKey(item.chatId, item.transport));
        continue;
      }

      const card = await parseStatusCardAsync(xmlText, item.applicationNumber);
      if (!card) {
        continue;
      }

      const snapshot = buildTrackingSnapshot(card);
      if (snapshot === normalizeText(item.lastSnapshot)) {
      updateEntry({
        transport: item.transport,
        chatId: item.chatId,
        applicationNumber: item.applicationNumber,
        updates: { lastCheckedAt: new Date().toISOString() },
        });
        continue;
      }

      updateEntry({
        transport: item.transport,
        chatId: item.chatId,
        applicationNumber: item.applicationNumber,
        updates: {
          lastSnapshot: snapshot,
          lastCheckedAt: new Date().toISOString(),
          applicantName: normalizeText(item.tag || item.applicantName || ''),
          ...deriveVahanTimeline(card),
        },
      });

      await sendTrackedUpdate(item, card);
      if (isDispatchedCard(card)) {
        removeTrack(item.chatId, item.applicationNumber, item.transport);
      }
    } catch (error) {
      // Keep the entry; the session may simply have expired.
    } finally {
      session.requestInFlight = false;
    }
  }
}

async function refreshTrackedApplications(chatId, transport = 'whatsapp') {
  transport = normalizeTransport(transport);
  const activeClient = getActiveClient(transport);
  if (!activeClient) {
    throw new Error(`${transport} client is not ready.`);
  }

  const entries = listTrack(chatId, transport);

  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    if (index > 0) {
      await sleepFn(randomBetween(5 * 1000, 10 * 1000));
    }

    const session = getSessionByTransport(chatId, transport);
    if (!session || !session.authenticated || session.requestInFlight) {
      await startLookup(activeClient, chatId, item.applicationNumber, transport, { sendStatusImage: false });
      const sessionAfterLookup = getSessionByTransport(chatId, transport);
      if (!sessionAfterLookup || !sessionAfterLookup.authenticated) {
        break;
      }
      continue;
    }

    session.requestInFlight = true;
    try {
      const xmlText = await submitWithAuthenticatedSession(session, item.applicationNumber);
      if (await isSessionExpiredResponse(xmlText, item.applicationNumber)) {
        sessions.delete(getSessionKey(chatId, transport));
        await startLookup(activeClient, chatId, item.applicationNumber, transport, { sendStatusImage: false });
        const sessionAfterReauth = getSessionByTransport(chatId, transport);
        if (!sessionAfterReauth || !sessionAfterReauth.authenticated) {
          break;
        }
        continue;
      }

      const card = await parseStatusCardAsync(xmlText, item.applicationNumber);
      if (!card) {
        continue;
      }
      const snapshot = buildTrackingSnapshot(card);

      updateEntry({
        transport,
        chatId,
        applicationNumber: item.applicationNumber,
        updates: {
          lastSnapshot: snapshot,
          lastCheckedAt: new Date().toISOString(),
          applicantName: normalizeText(item.tag || item.applicantName || ''),
          ...deriveVahanTimeline(card),
        },
      });

      if (snapshot !== normalizeText(item.lastSnapshot)) {
        await sendTrackedUpdate(item, card);
        if (isDispatchedCard(card)) {
          removeTrack(chatId, item.applicationNumber, transport);
        }
      }
    } finally {
      session.requestInFlight = false;
    }
  }

  return entries.length;
}

function startPolling(client, transport = 'whatsapp') {
  activeClients.set(normalizeTransport(transport), client);
  if (pollJob) {
    return pollJob;
  }

  pollJob = cron.schedule(CONFIG.VAHAN_TRACK.CRON, () => {
    pollTrackedApplications().catch(() => {});
  });

  return pollJob;
}

module.exports = {
  __private: {
    getCaptchaAttemptCount,
    getCaptchaRetryRangeMs,
    getUserFacingLookupError,
    isRetryableNetworkError,
    retryVahanHttpRequest,
    resetCaptchaSolverForTests: () => {
      captchaSolver = solveCaptcha;
    },
    resetHttpClientFactoryForTests: () => {
      httpClientFactory = createHttpClient;
    },
    resetSleepFnForTests: () => {
      sleepFn = sleep;
    },
    setCaptchaSolverForTests: (solver) => {
      captchaSolver = solver;
    },
    setHttpClientFactoryForTests: (factory) => {
      httpClientFactory = factory;
    },
    setSleepFnForTests: (fn) => {
      sleepFn = fn;
    },
    parseStatusCard,
    parseStatusCardAsync,
    buildTrackingSnapshot,
    deriveVahanTimeline,
    isIgnoredTransaction,
    isDispatchRcGenerated,
    classifyVahanStatus,
  },
  addTrack,
  getHelpText,
  handleIncomingText,
  hasActiveSession,
  listTrack,
  removeTrack,
  refreshTrackedApplications,
  startLookup,
  startPolling,
  stopSession,
};
