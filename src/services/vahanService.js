const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { MessageMedia } = require('whatsapp-web.js');
const CONFIG = require('../config/config');
const { renderHTML } = require('../core/puppeteerEngine');
const {
  addEntry,
  listEntries,
  readEntries,
  removeEntry,
  updateEntry,
} = require('./vahanTrackStore');

const FORM_URL =
  'https://vahan.parivahan.gov.in/vahanservice/vahan/ui/appl_status/form_Know_Appl_Status.xhtml';
const VAHAN_TRACK_REFRESH_MS = 3 * 60 * 60 * 1000;
const sessions = new Map();
let pollTimer = null;
let activeWhatsAppClient = null;

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

function resolveUrl(baseUrl, maybeRelativeUrl) {
  return new URL(maybeRelativeUrl, baseUrl).toString();
}

function createFilePath(chatId, suffix) {
  const safeChatId = String(chatId || 'unknown').replace(/[^a-z0-9_-]/gi, '_');
  return path.join(process.cwd(), `.tmp_vahan_${safeChatId}_${suffix}`);
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

  const captchaImage =
    $('img[id*="CaptchaImage"]').attr('src') ||
    $('img[id*="captcha"][src]').attr('src') ||
    $('img[src*="Captcha"]').attr('src') ||
    $('img[src*="captcha"]').attr('src');

  if (!viewState || !captchaImage) {
    throw new Error('Could not prepare the Vahan session right now.');
  }

  return {
    viewState,
    captchaInputName,
    radioFieldName,
    captchaImageUrl: resolveUrl(FORM_URL, captchaImage),
  };
}

async function downloadCaptcha(session) {
  const response = await session.httpClient.get(session.captchaImageUrl, {
    responseType: 'arraybuffer',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: FORM_URL,
    },
  });

  const filePath = createFilePath(session.chatId, 'captcha.png');
  fs.writeFileSync(filePath, Buffer.from(response.data));
  session.captchaPath = filePath;
  return filePath;
}

async function initializeSession(chatId, applicationNumber) {
  const existing = sessions.get(chatId);
  if (existing) {
    cleanupFile(existing.captchaPath);
  }

  const httpClient = createHttpClient();
  const response = await httpClient.get(FORM_URL);
  const initialState = extractInitialState(response.data);
  const session = {
    chatId,
    httpClient,
    applicationNumber: normalizeText(applicationNumber),
    viewState: initialState.viewState,
    captchaInputName: initialState.captchaInputName,
    radioFieldName: initialState.radioFieldName,
    captchaImageUrl: initialState.captchaImageUrl,
    waitingForCaptcha: true,
    authenticated: false,
    lastCaptchaText: '',
    captchaRetryCount: 0,
    requestInFlight: false,
  };

  await downloadCaptcha(session);
  sessions.set(chatId, session);
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

  const response = await session.httpClient.post(FORM_URL, body.toString(), {
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

  const response = await session.httpClient.post(FORM_URL, body.toString(), {
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

  const response = await session.httpClient.post(FORM_URL, body.toString(), {
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
  const fragment = extractStatusFragment(xmlText) || extractStatusGridFragment(xmlText);
  if (!fragment) {
    return null;
  }

  const $ = cheerio.load(fragment);
  const heading = normalizeText($('h2').first().text());
  const headingMatch = heading.match(
    /Application Status for Application Number\s+(.+?)\s+dated\s+-\s+(.+?)\s+against vehicle no\s+-\s+(.+)/i
  );

  const rows = $('#tb_appl_no_status_data tr, table tbody[id="tb_appl_no_status_data"] tr')
    .map((_, element) => {
      const cells = $(element).find('td');
      return {
        transactionPurpose: normalizeText(cells.eq(1).text()),
        currentStatus: normalizeText(cells.eq(3).text()),
      };
    })
    .get()
    .filter((row) => row.transactionPurpose || row.currentStatus);

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

function isIgnoredTransaction(transactionPurpose) {
  const text = normalizeText(transactionPurpose).toUpperCase();
  return text.includes('POSTAL FEE') || text.includes('SMART CARD FEE') || text.includes('MV TAX');
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

function isDispatchedCard(card) {
  return isMeaningfulValue(card.extra.dispatchRcStatus);
}

function buildTrackingSnapshot(card) {
  return JSON.stringify({
    rows: getRelevantRows(card).map((row) => normalizeText(row.currentStatus)),
    rcPrintOrSmartCardStatus: normalizeText(card.extra.rcPrintOrSmartCardStatus),
    dispatchRcStatus: normalizeText(card.extra.dispatchRcStatus),
  });
}

function getAutoTrackUpdateChatId() {
  return String(CONFIG.AUTO_TRACK.UPDATE_CHAT_ID || '').trim();
}

async function sendTrackedUpdate(client, item, card) {
  const targetChatId = getAutoTrackUpdateChatId();
  if (!targetChatId) {
    return false;
  }
  const imagePath = await renderStatusImage(card, targetChatId);

  try {
    await sendFileImage(
      client,
      targetChatId,
      imagePath,
      `Vahan status: ${card.vehicleNumber || item.applicationNumber}`
    );
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

function isSessionExpiredResponse(xmlText, fallbackApplicationNumber) {
  const text = normalizeText(xmlText).toUpperCase();
  if (!text) {
    return true;
  }

  if (text.includes('VERIFICATION CODE IS MISSING') || text.includes('VERIFICATION CODE DOES NOT MATCH')) {
    return true;
  }

  const card = parseStatusCard(xmlText, fallbackApplicationNumber);
  return !card;
}

function isCaptchaRejectedResponse(xmlText) {
  const text = normalizeText(xmlText).toUpperCase();
  return text.includes('VERIFICATION CODE IS MISSING') || text.includes('VERIFICATION CODE DOES NOT MATCH');
}

async function sendFileImage(client, chatId, imagePath, caption) {
  const media = MessageMedia.fromFilePath(imagePath);
  await client.sendMessage(chatId, media, { caption });
}

function getHelpText() {
  return [
    'WhatsApp commands:',
    'track <application_number> [dob]',
    'refresh track',
    'add track',
    'add track <application_number> [dob] -tag',
    'remove track <application_number>',
    'track rc <application_number>',
    'add track rc <application_number> -tag',
    'remove track rc <application_number>',
    'list track',
    'appl <application_number> <dob>',
    'form1 <application_number> <dob>',
    'form1a <application_number> <dob>',
    'form2 <application_number> <dob>',
    'formset <application_number> <dob>',
    'alive',
    'suno',
    'help',
    'stop',
  ].join('\n');
}

function getSession(chatId) {
  return sessions.get(chatId) || null;
}

function hasActiveSession(chatId) {
  return Boolean(getSession(chatId));
}

async function startLookup(client, chatId, applicationNumber) {
  const existing = getSession(chatId);
  if (existing && existing.authenticated) {
    try {
      const xmlText = await submitWithAuthenticatedSession(existing, applicationNumber);
      if (!isSessionExpiredResponse(xmlText, applicationNumber)) {
        const card = parseStatusCard(xmlText, applicationNumber);
        const imagePath = await renderStatusImage(card, chatId);
        await sendFileImage(
          client,
          chatId,
          imagePath,
          `Vahan status: ${card.vehicleNumber || card.applicationNumber}`
        );
        cleanupFile(imagePath);
        return;
      }
    } catch (error) {
      // Fall through to fresh captcha bootstrap when the session stops being usable.
    }
  }

  const session = await initializeSession(chatId, applicationNumber);
  const media = MessageMedia.fromFilePath(session.captchaPath);
  await client.sendMessage(chatId, media, {
    caption: [
      'Vahan captcha fetched.',
      `Application: ${session.applicationNumber}`,
      'Reply with only the captcha text.',
    ].join('\n'),
  });
  cleanupFile(session.captchaPath);
}

async function stopSession(chatId) {
  const session = getSession(chatId);
  if (!session) {
    return false;
  }

  cleanupFile(session.captchaPath);
  sessions.delete(chatId);
  return true;
}

async function handleIncomingText(client, chatId, text) {
  const session = getSession(chatId);
  if (!session) {
    return false;
  }

  const value = normalizeText(text);
  if (!value) {
    await client.sendMessage(chatId, 'Send the captcha text or another Vahan application number.');
    return true;
  }

  if (session.requestInFlight) {
    await client.sendMessage(chatId, 'One Vahan request is already running. Please wait a moment.');
    return true;
  }

  session.requestInFlight = true;

  try {
    let xmlText;
    const attemptedCaptcha = session.waitingForCaptcha;
    if (session.waitingForCaptcha) {
      xmlText = await submitWithCaptcha(session, value);
    } else if (session.authenticated && /^[A-Z0-9]+$/i.test(value)) {
      xmlText = await submitWithAuthenticatedSession(session, value);
    } else {
      await client.sendMessage(
        chatId,
        'Send another Vahan application number, `add track rc <appno> -tag`, `list track`, or `stop`.'
      );
      return true;
    }

    if (attemptedCaptcha && isCaptchaRejectedResponse(xmlText)) {
      if (session.captchaRetryCount < 1) {
        session.captchaRetryCount += 1;
        session.waitingForCaptcha = true;
        session.authenticated = false;
        await downloadCaptcha(session);
        const media = MessageMedia.fromFilePath(session.captchaPath);
        await client.sendMessage(chatId, media, {
          caption: [
            'Captcha did not match. Please try once more.',
            `Application: ${session.applicationNumber}`,
            'Reply with only the captcha text.',
          ].join('\n'),
        });
        cleanupFile(session.captchaPath);
        return true;
      }

      await stopSession(chatId);
      await client.sendMessage(
        chatId,
        'Captcha failed twice. Send `track rc <application_number>` for a fresh Vahan session.'
      );
      return true;
    }

    const card = parseStatusCard(xmlText, session.applicationNumber);
    if (!card) {
      await stopSession(chatId);
      await client.sendMessage(chatId, 'The Vahan captcha session looks expired. Send `track rc <application_number>` again for a fresh captcha.');
      return true;
    }

    const imagePath = await renderStatusImage(card, chatId);
    await sendFileImage(
      client,
      chatId,
      imagePath,
      `Vahan status: ${card.vehicleNumber || card.applicationNumber}`
    );
    cleanupFile(imagePath);

    session.authenticated = true;
    session.waitingForCaptcha = false;
    session.captchaRetryCount = 0;
    return true;
  } catch (error) {
    if (session) {
      session.waitingForCaptcha = !session.authenticated;
    }
    await client.sendMessage(chatId, `Vahan request failed: ${error.message}`);
    return true;
  } finally {
    session.requestInFlight = false;
  }
}

function addTrack(chatId, applicationNumber, tag) {
  return addEntry({
    transport: 'whatsapp',
    chatId,
    applicationNumber,
    tag,
  });
}

function removeTrack(chatId, applicationNumber) {
  return removeEntry({
    transport: 'whatsapp',
    chatId,
    applicationNumber,
  });
}

function listTrack(chatId) {
  return listEntries('whatsapp', chatId);
}

async function pollTrackedApplications() {
  if (!activeWhatsAppClient) {
    return;
  }

  const entries = readEntries().filter((item) => item.transport === 'whatsapp');
  for (const item of entries) {
    const lastCheckedAtMs = item.lastCheckedAt ? Date.parse(item.lastCheckedAt) : 0;
    const now = Date.now();
    if (lastCheckedAtMs && now - lastCheckedAtMs < VAHAN_TRACK_REFRESH_MS) {
      continue;
    }

    const session = getSession(item.chatId);
    if (!session || !session.authenticated || session.requestInFlight) {
      continue;
    }

    session.requestInFlight = true;
    try {
      const xmlText = await submitWithAuthenticatedSession(session, item.applicationNumber);
      if (isSessionExpiredResponse(xmlText, item.applicationNumber)) {
        sessions.delete(item.chatId);
        continue;
      }

      const card = parseStatusCard(xmlText, item.applicationNumber);
      if (!card) {
        continue;
      }

      const snapshot = buildTrackingSnapshot(card);
      if (snapshot === normalizeText(item.lastSnapshot)) {
        updateEntry({
          transport: 'whatsapp',
          chatId: item.chatId,
          applicationNumber: item.applicationNumber,
          updates: { lastCheckedAt: new Date().toISOString() },
        });
        continue;
      }

      updateEntry({
        transport: 'whatsapp',
        chatId: item.chatId,
        applicationNumber: item.applicationNumber,
        updates: {
          lastSnapshot: snapshot,
          lastCheckedAt: new Date().toISOString(),
        },
      });

      await sendTrackedUpdate(activeWhatsAppClient, item, card);
      if (isDispatchedCard(card)) {
        removeTrack(item.chatId, item.applicationNumber);
      }
    } catch (error) {
      // Keep the entry; the session may simply have expired.
    } finally {
      session.requestInFlight = false;
    }
  }
}

async function refreshTrackedApplications(chatId) {
  if (!activeWhatsAppClient) {
    throw new Error('WhatsApp client is not ready.');
  }

  const entries = listTrack(chatId);

  for (let index = 0; index < entries.length; index += 1) {
    const item = entries[index];
    if (index > 0) {
      await sleep(randomBetween(5 * 1000, 10 * 1000));
    }

    const session = getSession(chatId);
    if (!session || !session.authenticated || session.requestInFlight) {
      await startLookup(activeWhatsAppClient, chatId, item.applicationNumber);
      break;
    }

    session.requestInFlight = true;
    try {
      const xmlText = await submitWithAuthenticatedSession(session, item.applicationNumber);
      if (isSessionExpiredResponse(xmlText, item.applicationNumber)) {
        sessions.delete(chatId);
        await startLookup(activeWhatsAppClient, chatId, item.applicationNumber);
        break;
      }

      const card = parseStatusCard(xmlText, item.applicationNumber);
      if (!card) {
        continue;
      }
      const snapshot = buildTrackingSnapshot(card);

      updateEntry({
        transport: 'whatsapp',
        chatId,
        applicationNumber: item.applicationNumber,
        updates: {
          lastSnapshot: snapshot,
          lastCheckedAt: new Date().toISOString(),
        },
      });

      if (snapshot !== normalizeText(item.lastSnapshot)) {
        await sendTrackedUpdate(activeWhatsAppClient, item, card);
        if (isDispatchedCard(card)) {
          removeTrack(chatId, item.applicationNumber);
        }
      }
    } finally {
      session.requestInFlight = false;
    }
  }

  return entries.length;
}

function startPolling(client) {
  activeWhatsAppClient = client;
  if (pollTimer) {
    return;
  }

  pollTimer = setInterval(() => {
    pollTrackedApplications().catch(() => {});
  }, CONFIG.VAHAN_TRACK.POLL_INTERVAL_MS);
}

module.exports = {
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
