/**
 * Puppeteer engine responsibility:
 * Shared browser singleton for HTML rendering tasks.
 * Includes a page semaphore to limit concurrent open pages.
 */

const puppeteer = require('puppeteer');
const CONFIG = require('../config/config');
const logger = require('./logger');

let browserInstance = null;

// Page semaphore — limits concurrent open pages to prevent OOM
const MAX_PAGES = CONFIG.MAX_BROWSER_PAGES || 5;
let activePagesCount = 0;
const pageWaiters = [];

function buildLaunchArgs() {
  if (Array.isArray(CONFIG.PUPPETEER.ARGS) && CONFIG.PUPPETEER.ARGS.length > 0) {
    return CONFIG.PUPPETEER.ARGS;
  }

  const args = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
  ];

  if (CONFIG.PUPPETEER.DISABLE_SANDBOX) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return args;
}

async function getBrowser() {
  if (browserInstance) {
    return browserInstance;
  }

  const launchOptions = {
    headless: CONFIG.PUPPETEER.HEADLESS,
    defaultViewport: CONFIG.PUPPETEER.DEFAULT_VIEWPORT,
    args: buildLaunchArgs(),
  };

  if (CONFIG.PUPPETEER.EXECUTABLE_PATH) {
    launchOptions.executablePath = CONFIG.PUPPETEER.EXECUTABLE_PATH;
  }

  browserInstance = await puppeteer.launch(launchOptions);
  logger.info('puppeteerEngine', 'Browser launched');

  browserInstance.on('disconnected', () => {
    logger.warn('puppeteerEngine', 'Browser disconnected — will re-launch on next request');
    browserInstance = null;
    activePagesCount = 0;
    // Notify any waiting page acquirers so they retry
    const waiters = [...pageWaiters];
    pageWaiters.length = 0;
    for (const resolve of waiters) resolve();
  });

  return browserInstance;
}

/**
 * Acquire a new browser page, respecting the MAX_PAGES semaphore.
 * Callers must call releasePage(page) when done.
 * @returns {Promise<import('puppeteer').Page>}
 */
async function acquirePage() {
  if (activePagesCount >= MAX_PAGES) {
    logger.debug('puppeteerEngine', `Page semaphore full (${activePagesCount}/${MAX_PAGES}), waiting...`);
    await new Promise((resolve) => pageWaiters.push(resolve));
  }
  activePagesCount++;
  logger.debug('puppeteerEngine', `Page acquired (${activePagesCount}/${MAX_PAGES})`);
  const browser = await getBrowser();
  return browser.newPage();
}

/**
 * Release a page back to the pool (closes the page and signals waiters).
 * @param {import('puppeteer').Page} page
 */
async function releasePage(page) {
  try {
    if (page && !page.isClosed()) await page.close();
  } catch (_) {
    // ignore close errors
  }
  activePagesCount = Math.max(0, activePagesCount - 1);
  logger.debug('puppeteerEngine', `Page released (${activePagesCount}/${MAX_PAGES})`);
  if (pageWaiters.length > 0) {
    const resolve = pageWaiters.shift();
    resolve();
  }
}

function getPageStats() {
  return { activePages: activePagesCount, maxPages: MAX_PAGES, waiting: pageWaiters.length };
}

async function closeBrowser() {
  if (!browserInstance) {
    return;
  }

  const activeBrowser = browserInstance;
  browserInstance = null;
  activePagesCount = 0;
  pageWaiters.length = 0;
  await activeBrowser.close();
  logger.info('puppeteerEngine', 'Browser closed');
}

async function renderHTML(content, options = {}) {
  const {
    type,
    path,
    pdfOptions = {},
    imageOptions = {},
    waitForSelector = null,
    waitForFunction = null,
  } = options;

  const page = await acquirePage();

  try {
    await page.setContent(content, { waitUntil: 'domcontentloaded' });

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 30000 });
    }

    if (waitForFunction) {
      await page.waitForFunction(waitForFunction, { timeout: 30000 });
    }

    if (type === 'image') {
      await page.setViewport({
        width: 850,
        height: 1200,
        deviceScaleFactor: 2,
      });

      await page.screenshot({
        path,
        ...imageOptions,
      });
    } else if (type === 'pdf') {
      await page.pdf({
        path,
        ...pdfOptions,
      });
    } else {
      throw new Error('Invalid render type. Use "image" or "pdf".');
    }

    return path;
  } catch (error) {
    throw new Error(`Failed to render HTML: ${error.message}`);
  } finally {
    await releasePage(page);
  }
}

module.exports = {
  renderHTML,
  getBrowser,
  acquirePage,
  releasePage,
  getPageStats,
  closeBrowser,
};
