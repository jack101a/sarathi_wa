'use strict';
/**
 * Playwright Engine Wrapper
 *
 * Used on Server B (Home Mini PC 8GB) for heavy browser tasks.
 * Provides the same interface as puppeteerEngine.js so processor.js
 * can use either engine transparently via BROWSER_ENGINE env var.
 *
 * Set BROWSER_ENGINE=playwright in the worker-browser environment to use this engine.
 *
 * NOTE: playwright must be installed separately on Server B:
 *   npm install playwright
 *   npx playwright install chromium
 */

let _browser = null;

async function getBrowser() {
  if (_browser) return _browser;
  try {
    const { chromium } = require('playwright');
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,720',
      ],
    });
    _browser.on('disconnected', () => {
      console.warn('[playwright-engine] Browser disconnected. Will re-launch on next request.');
      _browser = null;
    });
    console.log('[playwright-engine] Playwright Chromium browser launched.');
    return _browser;
  } catch (err) {
    console.error('[playwright-engine] Failed to launch Playwright browser:', err.message);
    throw err;
  }
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

module.exports = { getBrowser, closeBrowser };
