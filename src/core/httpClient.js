/**
 * HTTP client responsibility:
 * Central place for outbound API request helpers.
 */

const axios = require('axios');
const CONFIG = require('../config/config');

const httpClient = axios.create({
  timeout: CONFIG.HTTP.TIMEOUT_MS,
  headers: {
    'User-Agent': CONFIG.HTTP.USER_AGENT,
  },
});

function buildRequestConfig(options = {}) {
  const mergedHeaders = {
    ...CONFIG.HTTP.HEADERS,
    ...(options.headers || {}),
  };

  return {
    ...options,
    headers: mergedHeaders,
  };
}

module.exports = {
  async get(url, options = {}) {
    const requestConfig = buildRequestConfig(options);

    try {
      if (CONFIG.DEBUG) {
        console.log('[httpClient] GET', url, requestConfig);
      }

      const response = await httpClient.get(url, requestConfig);
      return response;
    } catch (error) {
      const details =
        error.response?.data?.message ||
        error.response?.statusText ||
        error.message;
      throw new Error(`HTTP GET failed for ${url}: ${details}`);
    }
  },

  async post(url, data = {}, options = {}) {
    const requestConfig = buildRequestConfig(options);

    try {
      if (CONFIG.DEBUG) {
        console.log('[httpClient] POST', url, requestConfig);
      }

      const response = await httpClient.post(url, data, requestConfig);
      return response;
    } catch (error) {
      const details =
        error.response?.data?.message ||
        error.response?.statusText ||
        error.message;
      throw new Error(`HTTP POST failed for ${url}: ${details}`);
    }
  },
};
