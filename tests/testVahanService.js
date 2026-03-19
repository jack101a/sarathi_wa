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
  await testStartLookupReportsBootstrapFailures();
  await testStartLookupFallsBackToManualCaptchaAfterEightSolverFailures();
  console.log('PASS - vahan service retry, solver fallback, and bootstrap failure handling');
}

run().catch((error) => {
  resetTestOverrides();
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
