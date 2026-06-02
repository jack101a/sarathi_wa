'use strict';
/**
 * Puppeteer Engine Wrapper
 *
 * Used on Server A (Oracle Free Tier) for light-to-medium browser tasks.
 * Delegates to the existing monolith puppeteerEngine to avoid rewriting
 * battle-tested browser initialization logic.
 *
 * Set BROWSER_ENGINE=puppeteer in the worker-browser environment to use this engine.
 */

const { getBrowser, closeBrowser } = require('../../../../src/core/puppeteerEngine');

module.exports = { getBrowser, closeBrowser };
