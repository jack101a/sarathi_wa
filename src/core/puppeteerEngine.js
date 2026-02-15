/**
 * Puppeteer engine responsibility:
 * Shared browser singleton for HTML rendering tasks.
 */

const puppeteer = require('puppeteer');
const CONFIG = require('../config/config');

let browserInstance = null;

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

  browserInstance.on('disconnected', () => {
    browserInstance = null;
  });

  return browserInstance;
}

async function renderHTML(content, options = {}) {
  const { type, path, pdfOptions = {}, imageOptions = {} } = options;
  let page;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setContent(content, { waitUntil: 'domcontentloaded' });

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
    if (page) {
      await page.close();
    }
  }
}

module.exports = {
  renderHTML,
  getBrowser,
};
