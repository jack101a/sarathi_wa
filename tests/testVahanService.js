require('dotenv').config();

const assert = require('assert');
const CONFIG = require('../src/config/config');
const { setTelegramBot } = require('../src/services/chatNotifier');
const {
  __private,
  startLookup,
  stopSession,
} = require('../src/services/vahanService');

function createTestClient(log) {
  return {
    sendImage: async (...args) => {
      log.push(['image', ...args]);
    },
    sendText: async (...args) => {
      log.push(['text', ...args]);
    },
  };
}

function buildInitialFormHtml() {
  return `
    <html>
      <body>
        <form>
          <input name="javax.faces.ViewState" value="test-view-state" />
          <input id="vhn_cap:CaptchaID" name="vhn_cap:CaptchaID" />
          <input type="radio" name="j_idt394" value="applno" />
        </form>
      </body>
    </html>
  `;
}

function resetTestOverrides() {
  __private.resetCaptchaSolverForTests();
  __private.resetHttpClientFactoryForTests();
  __private.resetSleepFnForTests();
  setTelegramBot(null);
}

async function testRetryHelperRetriesTransientErrors() {
  let attempts = 0;

  const result = await __private.retryVahanHttpRequest(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('socket hang up');
      error.code = 'ECONNRESET';
      throw error;
    }

    return 'ok';
  });

  assert.strictEqual(result, 'ok');
  assert.strictEqual(attempts, 3, 'Expected transient errors to be retried.');
}

async function testStartLookupReportsBootstrapFailures() {
  const messages = [];

  __private.setHttpClientFactoryForTests(() => ({
    get: async () => {
      const error = new Error('socket hang up');
      error.code = 'ECONNRESET';
      throw error;
    },
    post: async () => {
      throw new Error('post should not be called during bootstrap failure test');
    },
  }));

  try {
    await startLookup(
      createTestClient(messages),
      'test-vahan-chat',
      'MH260310V7505731'
    );

    assert.strictEqual(messages.length, 1, 'Expected one failure message to be sent.');
    assert.strictEqual(messages[0][0], 'text');
    assert.strictEqual(messages[0][1], 'test-vahan-chat');
    assert.match(
      messages[0][2],
      /Vahan request failed: Could not reach the Vahan service right now/i
    );
  } finally {
    __private.resetHttpClientFactoryForTests();
  }
}

function testVahanStatusAnalyzerParsesServicesAndDispatchStrictly() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <partial-response>
      <changes>
        <update id="tb_showStatus"><![CDATA[
          <div>
            <h2>Application Status for Application Number MH260310V7505731 dated - 10-Mar-2026 14:03:15 against vehicle no - MH47BC5108</h2>
            <table>
              <tbody id="tb_appl_no_status_data">
                <tr><td>1</td><td>Hypothecation Termination</td><td></td><td>COMPLETED / APPROVED ON 27-Mar-2026 15:37:21 by user TEST</td></tr>
                <tr><td>2</td><td>Issue of Duplicate RC</td><td></td><td>COMPLETED / APPROVED ON 27-Mar-2026 15:32:05 by user TEST</td></tr>
                <tr><td>3</td><td>Postal Fee</td><td></td><td>ONLINE TRANSACTION SUCCESS ON 10-Mar-2026 14:08:29 .TRANSACTION COMPLETE.</td></tr>
                <tr><td>4</td><td>Smart Card Fee</td><td></td><td>ONLINE TRANSACTION SUCCESS ON 10-Mar-2026 14:08:29 .TRANSACTION COMPLETE.</td></tr>
              </tbody>
            </table>
            <table>
              <tbody id="tb_appl_no_status_detail_data">
                <tr>
                  <td></td><td></td>
                  <td>SMART CARD Generated 28-Mar-2026 00:25:10 by user SMARTCARD VENDOR</td>
                  <td>DISPATCH RC Status : DISPATCH RC Generated [ApplNo/Barcode: MH260310V7505731/TA801303296IN] dated 28-Mar-2026 09:45:07 by user MH RC VENDOR DISPATCH</td>
                </tr>
              </tbody>
            </table>
          </div>
        ]]></update>
      </changes>
    </partial-response>`;

  const card = __private.parseStatusCard(xml, 'fallback');
  assert.strictEqual(card.vehicleNumber, 'MH47BC5108');
  assert.strictEqual(card.applicationDate, '10-Mar-2026 14:03:15');

  const snapshot = JSON.parse(__private.buildTrackingSnapshot(card));
  assert.deepStrictEqual(
    snapshot.rows.map((row) => row.transactionPurpose),
    ['Hypothecation Termination', 'Issue of Duplicate RC']
  );

  const timeline = __private.deriveVahanTimeline(card);
  assert.strictEqual(timeline.serviceName, 'Hypothecation Termination, Issue of Duplicate RC');
  assert.strictEqual(timeline.applicationDate, '10-Mar-2026 14:03:15');
  assert.strictEqual(timeline.vehicleNo, 'MH47BC5108');
  assert.strictEqual(timeline.approvalAt, '27-03-2026');
  assert.strictEqual(timeline.dispatchedAt, '28-03-2026');
  assert.strictEqual(__private.classifyVahanStatus(card.rows[0].currentStatus).status, 'Approved');
  assert.strictEqual(__private.isDispatchRcGenerated(card.extra.dispatchRcStatus), true);

  const pendingDispatchCard = {
    ...card,
    extra: {
      ...card.extra,
      dispatchRcStatus: 'DISPATCH RC Status : Pending',
    },
  };
  assert.strictEqual(__private.deriveVahanTimeline(pendingDispatchCard).dispatchedAt, '');
}

function testVahanTwoColumnTableParsesServiceNameAndStatus() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <partial-response>
      <changes>
        <update id="tb_showStatus"><![CDATA[
          <div>
            <h2>Application Status for Application Number MH260418V3806213 dated - 08-May-2026 12:00:00 against vehicle no - MH12AB1234</h2>
            <table>
              <tbody id="tb_appl_no_status_data">
                <tr><td>Issue of Duplicate RC</td><td>COMPLETED / APPROVED ON 08-May-2026 12:12:10 by user TEST</td></tr>
                <tr><td>Smart Card Fee</td><td>ONLINE TRANSACTION SUCCESS ON 08-May-2026 12:10:00 .TRANSACTION COMPLETE.</td></tr>
              </tbody>
            </table>
            <table>
              <tbody id="tb_appl_no_status_detail_data">
                <tr><td></td><td></td><td>Not Available</td><td>DISPATCH RC Status : Pending</td></tr>
              </tbody>
            </table>
          </div>
        ]]></update>
      </changes>
    </partial-response>`;

  const card = __private.parseStatusCard(xml, 'fallback');
  assert.strictEqual(card.vehicleNumber, 'MH12AB1234');
  assert.strictEqual(card.applicationDate, '08-May-2026 12:00:00');

  const timeline = __private.deriveVahanTimeline(card);
  assert.strictEqual(timeline.serviceName, 'Issue of Duplicate RC');
  assert.strictEqual(timeline.approvalAt, '08-05-2026');
  assert.strictEqual(timeline.dispatchedAt, '');
}

function testVahanSplitStatusAndGridFragmentsParseServiceName() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <partial-response>
      <changes>
        <update id="tb_showStatus"><![CDATA[
          <div>
            <h2>Application Status for Application Number MH260418V3806213 dated - 08-May-2026 12:00:00 against vehicle no - MH12AB1234</h2>
          </div>
        ]]></update>
        <update id="tb_appl_no_status_grv"><![CDATA[
          <table>
            <tbody id="tb_appl_no_status_data">
              <tr><td>1</td><td>Hypothecation Addition</td><td></td><td>PENDING AT SCRUTINY ON 08-May-2026 12:12:10</td></tr>
              <tr><td>2</td><td>Smart Card Fee</td><td></td><td>ONLINE TRANSACTION SUCCESS ON 08-May-2026 12:10:00 .TRANSACTION COMPLETE.</td></tr>
            </tbody>
          </table>
          <table>
            <tbody id="tb_appl_no_status_detail_data">
              <tr><td></td><td></td><td>Not Available</td><td>DISPATCH RC Status : Pending</td></tr>
            </tbody>
          </table>
        ]]></update>
      </changes>
    </partial-response>`;

  const card = __private.parseStatusCard(xml, 'fallback');
  const timeline = __private.deriveVahanTimeline(card);
  assert.strictEqual(card.vehicleNumber, 'MH12AB1234');
  assert.strictEqual(card.rows.length, 2);
  assert.strictEqual(timeline.serviceName, 'Hypothecation Addition');
  assert.strictEqual(timeline.scrutinyAt, '08-05-2026');
}

function testVahanFallbackTableParserWithoutKnownIds() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <partial-response>
      <changes>
        <update id="tb_showStatus"><![CDATA[
          <div>
            <h2>Application Status for Application Number MH260418V3806213 dated - 08-May-2026 12:00:00 against vehicle no - MH12AB1234</h2>
            <table>
              <tr><th>Transaction</th><th>Current Status</th></tr>
              <tr><td>Hypothecation Termination</td><td>COMPLETED / APPROVED ON 08-May-2026 12:12:10 by user TEST</td></tr>
              <tr><td>Postal Fee</td><td>ONLINE TRANSACTION SUCCESS ON 08-May-2026 12:10:00 .TRANSACTION COMPLETE.</td></tr>
            </table>
            <table>
              <tbody id="tb_appl_no_status_detail_data">
                <tr><td></td><td></td><td>Not Available</td><td>DISPATCH RC Status : Pending</td></tr>
              </tbody>
            </table>
          </div>
        ]]></update>
      </changes>
    </partial-response>`;

  const card = __private.parseStatusCard(xml, 'fallback');
  const timeline = __private.deriveVahanTimeline(card);
  assert.strictEqual(timeline.serviceName, 'Hypothecation Termination');
  assert.strictEqual(timeline.approvalAt, '08-05-2026');
}

function testVahanKeepsTaxTransactionAsService() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <partial-response>
      <changes>
        <update id="tb_showStatus"><![CDATA[
          <div>
            <h2>Application Status for Application Number MH260418V3806213 dated - 18-Apr-2026 10:55:41 against vehicle no - MH02BR1458</h2>
            <table>
              <tbody id="tb_appl_no_status_data">
                <tr><td>1</td><td>MV Tax</td><td>Mobile</td><td>ONLINE TRANSACTION SUCCESS ON 18-Apr-2026 10:55:41 .TRANSACTION COMPLETE.</td><td></td><td>ONLINE SERVICE</td></tr>
              </tbody>
            </table>
            <table>
              <tbody id="tb_appl_no_status_detail_data">
                <tr><td>Not Available</td><td>Not Available</td><td>Not Available</td><td>Not Available</td></tr>
              </tbody>
            </table>
          </div>
        ]]></update>
      </changes>
    </partial-response>`;

  const card = __private.parseStatusCard(xml, 'fallback');
  const snapshot = JSON.parse(__private.buildTrackingSnapshot(card));
  const timeline = __private.deriveVahanTimeline(card);
  assert.strictEqual(snapshot.rows[0].transactionPurpose, 'MV Tax');
  assert.strictEqual(timeline.serviceName, 'MV Tax');
  assert.strictEqual(timeline.approvalAt, '18-04-2026');
}

function testVahanNotInwardedHasNoScrutinyOrApproval() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <partial-response>
      <changes>
        <update id="tb_showStatus"><![CDATA[
          <div>
            <h2>Application Status for Application Number MH260507V1745659 dated - 07-May-2026 13:59:11 against vehicle no - MH47BL6238</h2>
            <table>
              <tbody id="tb_appl_no_status_data">
                <tr><td>1</td><td>Fitness Inspection/Certificate</td><td></td><td>ONLINE TRANSACTION SUCCESS ON 07-May-2026 13:59:11 BUT NOT INWARDED AT R.T.O.BORIVALI (MH-47)</td></tr>
              </tbody>
            </table>
            <table>
              <tbody id="tb_appl_no_status_detail_data">
                <tr><td>Not Available</td><td>Not Available</td><td>Not Available</td><td>Not Available</td></tr>
              </tbody>
            </table>
          </div>
        ]]></update>
      </changes>
    </partial-response>`;

  const card = __private.parseStatusCard(xml, 'fallback');
  const timeline = __private.deriveVahanTimeline(card);
  assert.strictEqual(timeline.serviceName, 'Fitness Inspection/Certificate');
  assert.strictEqual(timeline.scrutinyAt, '', 'Expected empty scrutiny date for NOT INWARDED status');
  assert.strictEqual(timeline.approvalAt, '', 'Expected empty approval date for NOT INWARDED status');
  assert.strictEqual(timeline.dispatchedAt, '', 'Expected empty dispatch date for NOT INWARDED status');
}

async function testStartLookupFallsBackToManualCaptchaAfterEightSolverFailures() {
  const originalNotifyChatIds = CONFIG.TELEGRAM.NOTIFY_CHAT_IDS;
  const originalAttemptCount = CONFIG.VAHAN_TRACK.CAPTCHA_MAX_ATTEMPTS;
  let solverAttempts = 0;
  let getCalls = 0;
  const whatsappMessages = [];
  const telegramPhotos = [];
  const telegramTexts = [];

  CONFIG.TELEGRAM.NOTIFY_CHAT_IDS = ['tg-fallback-chat'];
  CONFIG.VAHAN_TRACK.CAPTCHA_MAX_ATTEMPTS = 8;

  __private.setSleepFnForTests(async () => {});
  __private.setCaptchaSolverForTests(async () => {
    solverAttempts += 1;
    throw new Error('solver failed');
  });
  __private.setHttpClientFactoryForTests(() => ({
    get: async (url, options = {}) => {
      getCalls += 1;
      if (String(url).includes('form_Know_Appl_Status.xhtml')) {
        return { data: buildInitialFormHtml() };
      }

      return {
        data: options.responseType === 'arraybuffer' ? Buffer.from('fake-png-data') : Buffer.from('fake-png-data'),
      };
    },
    post: async () => {
      throw new Error('post should not be called when the solver fails before submit');
    },
  }));

  setTelegramBot({
    sendMessage: async (...args) => {
      telegramTexts.push(args);
    },
    sendPhoto: async (...args) => {
      telegramPhotos.push(args);
    },
  });

  try {
    await startLookup(
      createTestClient(whatsappMessages),
      'wa-fallback-chat',
      'MH260310V7505731'
    );

    assert.strictEqual(solverAttempts, 8, 'Expected eight automatic captcha solve attempts.');
    assert.ok(getCalls >= 9, 'Expected captcha bootstrap and retries to fetch captcha images.');
    assert.strictEqual(whatsappMessages.length, 1, 'Expected one WhatsApp captcha fallback message.');
    assert.strictEqual(whatsappMessages[0][0], 'image');
    assert.strictEqual(telegramPhotos.length, 1, 'Expected one Telegram captcha photo fallback.');
    assert.strictEqual(telegramTexts.length, 1, 'Expected one Telegram instruction message.');
    assert.match(
      whatsappMessages[0][3],
      /Automatic captcha solving failed\. Please solve it manually\./i
    );
  } finally {
    await stopSession('wa-fallback-chat');
    CONFIG.TELEGRAM.NOTIFY_CHAT_IDS = originalNotifyChatIds;
    CONFIG.VAHAN_TRACK.CAPTCHA_MAX_ATTEMPTS = originalAttemptCount;
    resetTestOverrides();
  }
}

async function run() {
  await testRetryHelperRetriesTransientErrors();
  testVahanStatusAnalyzerParsesServicesAndDispatchStrictly();
  testVahanTwoColumnTableParsesServiceNameAndStatus();
  testVahanSplitStatusAndGridFragmentsParseServiceName();
  testVahanFallbackTableParserWithoutKnownIds();
  testVahanKeepsTaxTransactionAsService();
  testVahanNotInwardedHasNoScrutinyOrApproval();
  await testStartLookupReportsBootstrapFailures();
  await testStartLookupFallsBackToManualCaptchaAfterEightSolverFailures();
  console.log('PASS - vahan service retry, solver fallback, and bootstrap failure handling');
}

run().catch((error) => {
  resetTestOverrides();
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
