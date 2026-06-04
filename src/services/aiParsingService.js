const cheerio = require('cheerio');
const crypto = require('crypto');
const axios = require('axios');
const CONFIG = require('../config/config');
const db = require('../core/db');

const inMemoryCache = new Map();
let cacheInitialized = false;
let initPromise = null;

async function initializeCache() {
  try {
    const rows = await db.query('SELECT layout_hash, mapping_rules FROM ai_layout_mappings');
    for (const row of rows) {
      try {
        inMemoryCache.set(row.layout_hash, JSON.parse(row.mapping_rules));
      } catch (e) {
        console.error(`[AI Parsing] Error parsing mapping rules for hash ${row.layout_hash}:`, e);
      }
    }
    console.log(`[AI Parsing] Initialized cache with ${inMemoryCache.size} layouts.`);
  } catch (err) {
    console.error('[AI Parsing] Failed to initialize layout mapping cache from PostgreSQL:', err);
  }
}

async function ensureCacheInitialized() {
  if (cacheInitialized) return;
  if (!initPromise) {
    initPromise = initializeCache().then(() => {
      cacheInitialized = true;
    });
  }
  await initPromise;
}

/**
 * Generate structural layout hash from HTML status page.
 * Replaces dynamic texts (application numbers, vehicle numbers, dates) with stable tokens.
 */
function generateLayoutHash(html, portalType) {
  const $ = cheerio.load(html || '');
  $('script, style, nav, header, footer, link, meta, head').remove();

  let structure = '';

  $('*').each((i, el) => {
    const tagName = el.name;
    if (['table', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'fieldset', 'legend', 'div', 'span', 'p', 'b'].includes(tagName)) {
      structure += `<${tagName}`;
      const colspan = $(el).attr('colspan');
      const rowspan = $(el).attr('rowspan');
      if (colspan) structure += ` colspan="${colspan}"`;
      if (rowspan) structure += ` rowspan="${rowspan}"`;

      const children = el.children || [];
      const hasTextChild = children.some(child => child.type === 'text' && child.data.trim().length > 0);
      if (hasTextChild) {
        let text = $(el).text().replace(/\s+/g, ' ').trim();
        // Replace dates: DD-MM-YYYY, DD/MM/YYYY, DD-MMM-YYYY
        text = text.replace(/\b\d{1,2}[-/]([A-Za-z]{3}|\d{1,2})[-/]\d{4}\b/g, '<DATE>');
        // Replace times: HH:MM:SS
        text = text.replace(/\b\d{2}:\d{2}:\d{2}\b/g, '<TIME>');
        // Replace all uppercase, numeric, hyphenated or slash-based tokens (length >= 2) with <UPPER>
        // This covers application numbers, DL numbers, vehicle numbers, RTO codes, status words (COMPLETED, APPROVED), etc.
        text = text.replace(/\b[A-Z0-9/-]{2,}\b/g, '<UPPER>');
        // Replace any remaining digits
        text = text.replace(/\b\d+\b/g, '<NUM>');

        structure += `>${text}</${tagName}>`;
      } else {
        structure += '>';
      }
    }
  });

  return crypto.createHash('md5').update(`${portalType}:${structure}`).digest('hex');
}

function cleanJsonResponse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  }
  return JSON.parse(cleaned);
}

/**
 * Call LiteLLM completions endpoint to parse status content.
 */
async function parseWithLLM(html, portalType) {
  const url = `${CONFIG.AI_PARSING.API_BASE}/chat/completions`;
  const systemPrompt = portalType === 'sarathi'
    ? `You are an expert data extraction assistant. Your task is to parse the status page of a driving licence / learning licence application (Sarathi portal) and return a JSON object with the following fields:
{
  "applicantName": "Full name of the applicant, or empty string if not found",
  "dlNumber": "Driving Licence Number / Learner Licence Number if present on the page, or empty string",
  "trackerNo": "Speed Post Tracker Number / Tracking Number if present, or empty string",
  "message": "The main status message or heading (e.g. 'Licence has been Approved', 'Licence has been dispatched'), or empty string",
  "transaction": "The transaction or service name (e.g. 'ISSUE OF DRIVING LICENCE'), or empty string",
  "stage": "The current stage of the application, or empty string",
  "counter": "The counter name (e.g. 'DL-APPROVAL-CO'), or empty string",
  "kind": "One of: 'pending' | 'approved' | 'dispatched' | 'pending-counter' | 'approval-stage'",
  "completedActions": [
    {
      "actionName": "Name of the completed action/stage (e.g. SCRUTINY, CAPTURE PHOTO & SIGNATURE)",
      "status": "Status (e.g. COMPLETED)",
      "processedOn": "Date of completion in DD-MM-YYYY format"
    }
  ],
  "furtherActions": [
    {
      "actionName": "Name of the pending/further action",
      "status": "Status (e.g. PENDING)"
    }
  ]
}
Return ONLY a valid JSON object. Do not include markdown code block formatting or explanations. Just the JSON.`
    : `You are an expert data extraction assistant. Your task is to parse the application status page of a vehicle registration / services portal (Vahan portal) and return a JSON object with the following fields:
{
  "applicationNumber": "The application number (e.g., MH2602...), or empty string",
  "applicationDate": "The application date in DD-MM-YYYY format, or empty string",
  "vehicleNumber": "The vehicle number/registration number (e.g., MH12AB1234), or empty string",
  "rows": [
    {
      "transactionPurpose": "The name of the transaction or service purpose (e.g., Duplicate RC, Hypothecation Addition)",
      "currentStatus": "The current status text (e.g., APPROVED, PENDING, SCRUTINY, COMPLETED) including any date if present in the status cell"
    }
  ],
  "extra": {
    "rcPrintOrSmartCardStatus": "The status of RC Print or Smart Card if present, or empty string",
    "dispatchRcStatus": "The status of dispatch RC if present, or empty string"
  }
}
Return ONLY a valid JSON object. Do not include markdown code block formatting or explanations. Just the JSON.`;

  const headers = {
    'Content-Type': 'application/json',
  };
  if (CONFIG.AI_PARSING.API_KEY) {
    headers['Authorization'] = `Bearer ${CONFIG.AI_PARSING.API_KEY}`;
  }

  const $ = cheerio.load(html || '');
  $('script, style, nav, header, footer, link, meta, head').remove();
  const cleanedHtml = $.html();

  const payload = {
    model: CONFIG.AI_PARSING.MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: cleanedHtml }
    ],
    temperature: 0.1,
  };

  const response = await axios.post(url, payload, { headers, timeout: 30000 });
  const rawText = response.data?.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error('LiteLLM returned an empty response.');
  }

  try {
    return cleanJsonResponse(rawText);
  } catch (err) {
    console.error('[AI Parsing] Failed to parse LLM JSON response. Raw text:', rawText);
    throw err;
  }
}

function findPathForText($, targetText) {
  if (!targetText) return null;
  const normalizedTarget = targetText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalizedTarget) return null;

  let bestEl = null;
  let bestLen = Infinity;

  $('*').each((i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
    if (text.includes(normalizedTarget)) {
      const len = text.length;
      if (len < bestLen) {
        bestLen = len;
        bestEl = el;
      }
    }
  });

  if (!bestEl) return null;

  const path = [];
  let cur = $(bestEl);
  while (cur.length > 0 && cur[0].name !== 'body' && cur[0].name !== 'html') {
    const name = cur[0].name;
    const parent = cur.parent();
    if (parent.length > 0) {
      const siblings = parent.children(name);
      const index = siblings.index(cur);
      path.unshift({ name, index });
    } else {
      path.unshift({ name, index: 0 });
    }
    cur = parent;
  }
  return path;
}

function getTableByPath($, path) {
  if (!path || path.length === 0) return null;
  let cur = $('body');
  for (const step of path) {
    const children = cur.children(step.name);
    if (children.length <= step.index) return null;
    cur = $(children.get(step.index));
  }
  return cur;
}

function getValueFromPath($, path) {
  const el = getTableByPath($, path);
  return el ? el.text().replace(/\s+/g, ' ').trim() : '';
}

function learnRegexPattern(cellText, learnedValue) {
  const index = cellText.toLowerCase().indexOf(learnedValue.toLowerCase());
  if (index === -1) return null;
  const prefix = cellText.slice(0, index);
  const suffix = cellText.slice(index + learnedValue.length);
  return { prefix, suffix };
}

function extractValueWithPattern(cellText, pattern) {
  if (!pattern) return cellText;
  let result = cellText;
  if (pattern.prefix && result.toLowerCase().startsWith(pattern.prefix.toLowerCase())) {
    result = result.slice(pattern.prefix.length);
  }
  if (pattern.suffix && result.toLowerCase().endsWith(pattern.suffix.toLowerCase())) {
    result = result.slice(0, result.length - pattern.suffix.length);
  }
  return result.trim();
}

function findTablePathForRows($, rows) {
  if (!rows || rows.length === 0) return null;

  let bestTable = null;
  let bestMatchCount = 0;

  $('table').each((i, el) => {
    const tableText = $(el).text().toLowerCase();
    let matchCount = 0;
    for (const row of rows) {
      for (const val of Object.values(row)) {
        if (val && tableText.includes(String(val).toLowerCase())) {
          matchCount++;
        }
      }
    }
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestTable = el;
    }
  });

  if (!bestTable) return null;

  const path = [];
  let cur = $(bestTable);
  while (cur.length > 0 && cur[0].name !== 'body' && cur[0].name !== 'html') {
    const name = cur[0].name;
    const parent = cur.parent();
    if (parent.length > 0) {
      const siblings = parent.children(name);
      const index = siblings.index(cur);
      path.unshift({ name, index });
    } else {
      path.unshift({ name, index: 0 });
    }
    cur = parent;
  }

  const tableRows = $(bestTable).find('tr');
  const firstDataRow = rows[0];
  const keys = Object.keys(firstDataRow);

  let keyToCellIndex = {};
  let startRowIndex = 0;

  tableRows.each((rowIndex, tr) => {
    const cells = $(tr).find('td, th');
    let matchesAllKeys = true;
    let tempMapping = {};

    for (const key of keys) {
      const val = String(firstDataRow[key]).toLowerCase().trim();
      if (!val) continue;

      let found = false;
      cells.each((cellIndex, td) => {
        const cellText = $(td).text().toLowerCase().trim();
        if (cellText.includes(val)) {
          tempMapping[key] = cellIndex;
          found = true;
        }
      });
      if (!found) {
        matchesAllKeys = false;
      }
    }

    if (matchesAllKeys && Object.keys(tempMapping).length > 0) {
      keyToCellIndex = tempMapping;
      startRowIndex = rowIndex;
      return false; // break loop
    }
  });

  return {
    path,
    keyToCellIndex,
    startRowIndex
  };
}

/**
 * Deduce coordinate mapping rules from LLM-parsed JSON result and HTML source.
 */
function autoTrainLayout(html, parsedData, portalType) {
  const $ = cheerio.load(html || '');
  $('script, style, nav, header, footer, link, meta, head').remove();

  const rules = {
    portalType,
    fields: {},
    tables: {}
  };

  if (portalType === 'sarathi') {
    const stringFields = ['transaction', 'stage', 'counter', 'dlNumber', 'trackerNo', 'message'];
    for (const field of stringFields) {
      const val = parsedData[field];
      if (val && typeof val === 'string') {
        const path = findPathForText($, val);
        if (path) {
          const cellText = getValueFromPath($, path);
          const pattern = learnRegexPattern(cellText, val);
          rules.fields[field] = { path, pattern };
        }
      }
    }

    rules.fields['kind'] = { staticValue: parsedData['kind'] || 'pending' };

    if (parsedData.completedActions && parsedData.completedActions.length > 0) {
      const tableRule = findTablePathForRows($, parsedData.completedActions);
      if (tableRule) {
        rules.tables['completedActions'] = tableRule;
      }
    }
    if (parsedData.furtherActions && parsedData.furtherActions.length > 0) {
      const tableRule = findTablePathForRows($, parsedData.furtherActions);
      if (tableRule) {
        rules.tables['furtherActions'] = tableRule;
      }
    }

  } else if (portalType === 'vahan') {
    const stringFields = ['applicationNumber', 'applicationDate', 'vehicleNumber'];
    for (const field of stringFields) {
      const val = parsedData[field];
      if (val && typeof val === 'string') {
        const path = findPathForText($, val);
        if (path) {
          const cellText = getValueFromPath($, path);
          const pattern = learnRegexPattern(cellText, val);
          rules.fields[field] = { path, pattern };
        }
      }
    }

    if (parsedData.extra) {
      rules.fields['extra'] = {};
      const extraFields = ['rcPrintOrSmartCardStatus', 'dispatchRcStatus'];
      for (const field of extraFields) {
        const val = parsedData.extra[field];
        if (val && typeof val === 'string') {
          const path = findPathForText($, val);
          if (path) {
            const cellText = getValueFromPath($, path);
            const pattern = learnRegexPattern(cellText, val);
            rules.fields['extra'][field] = { path, pattern };
          }
        }
      }
    }

    if (parsedData.rows && parsedData.rows.length > 0) {
      const tableRule = findTablePathForRows($, parsedData.rows);
      if (tableRule) {
        rules.tables['rows'] = tableRule;
      }
    }
  }

  return rules;
}

/**
 * Extract status using trained coordinate rules.
 */
function parseUsingMapping(html, rules) {
  const $ = cheerio.load(html || '');
  $('script, style, nav, header, footer, link, meta, head').remove();

  const parsed = {};

  if (rules.portalType === 'sarathi') {
    for (const [field, config] of Object.entries(rules.fields)) {
      if (config.staticValue !== undefined) {
        parsed[field] = config.staticValue;
      } else if (config.path) {
        const rawVal = getValueFromPath($, config.path);
        parsed[field] = extractValueWithPattern(rawVal, config.pattern);
      } else {
        parsed[field] = '';
      }
    }

    const standardFields = ['transaction', 'stage', 'counter', 'dlNumber', 'trackerNo', 'message', 'kind'];
    for (const f of standardFields) {
      if (parsed[f] === undefined) parsed[f] = '';
    }

    parsed.completedActions = [];
    if (rules.tables.completedActions) {
      const tableRule = rules.tables.completedActions;
      const tableEl = getTableByPath($, tableRule.path);
      if (tableEl) {
        const rows = $(tableEl).find('tr');
        rows.each((rowIndex, tr) => {
          if (rowIndex < tableRule.startRowIndex) return;
          const cells = $(tr).find('td, th');
          const rowObj = {};
          let hasData = false;
          for (const [key, cellIndex] of Object.entries(tableRule.keyToCellIndex)) {
            if (cellIndex < cells.length) {
              const cellText = $(cells.get(cellIndex)).text().replace(/\s+/g, ' ').trim();
              rowObj[key] = cellText;
              if (cellText) hasData = true;
            } else {
              rowObj[key] = '';
            }
          }
          if (hasData) {
            parsed.completedActions.push(rowObj);
          }
        });
      }
    }

    parsed.furtherActions = [];
    if (rules.tables.furtherActions) {
      const tableRule = rules.tables.furtherActions;
      const tableEl = getTableByPath($, tableRule.path);
      if (tableEl) {
        const rows = $(tableEl).find('tr');
        rows.each((rowIndex, tr) => {
          if (rowIndex < tableRule.startRowIndex) return;
          const cells = $(tr).find('td, th');
          const rowObj = {};
          let hasData = false;
          for (const [key, cellIndex] of Object.entries(tableRule.keyToCellIndex)) {
            if (cellIndex < cells.length) {
              const cellText = $(cells.get(cellIndex)).text().replace(/\s+/g, ' ').trim();
              rowObj[key] = cellText;
              if (cellText) hasData = true;
            } else {
              rowObj[key] = '';
            }
          }
          if (hasData) {
            parsed.furtherActions.push(rowObj);
          }
        });
      }
    }

  } else if (rules.portalType === 'vahan') {
    for (const [field, config] of Object.entries(rules.fields)) {
      if (field === 'extra') {
        parsed.extra = {};
        for (const [extraField, extraConfig] of Object.entries(config)) {
          if (extraConfig.path) {
            const rawVal = getValueFromPath($, extraConfig.path);
            parsed.extra[extraField] = extractValueWithPattern(rawVal, extraConfig.pattern);
          } else {
            parsed.extra[extraField] = '';
          }
        }
      } else {
        if (config.path) {
          const rawVal = getValueFromPath($, config.path);
          parsed[field] = extractValueWithPattern(rawVal, config.pattern);
        } else {
          parsed[field] = '';
        }
      }
    }

    if (!parsed.applicationNumber) parsed.applicationNumber = '';
    if (!parsed.applicationDate) parsed.applicationDate = '';
    if (!parsed.vehicleNumber) parsed.vehicleNumber = '';
    if (!parsed.extra) {
      parsed.extra = { rcPrintOrSmartCardStatus: '', dispatchRcStatus: '' };
    } else {
      if (!parsed.extra.rcPrintOrSmartCardStatus) parsed.extra.rcPrintOrSmartCardStatus = '';
      if (!parsed.extra.dispatchRcStatus) parsed.extra.dispatchRcStatus = '';
    }

    parsed.rows = [];
    if (rules.tables.rows) {
      const tableRule = rules.tables.rows;
      const tableEl = getTableByPath($, tableRule.path);
      if (tableEl) {
        const rows = $(tableEl).find('tr');
        rows.each((rowIndex, tr) => {
          if (rowIndex < tableRule.startRowIndex) return;
          const cells = $(tr).find('td, th');
          const rowObj = {};
          let hasData = false;
          for (const [key, cellIndex] of Object.entries(tableRule.keyToCellIndex)) {
            if (cellIndex < cells.length) {
              const cellText = $(cells.get(cellIndex)).text().replace(/\s+/g, ' ').trim();
              rowObj[key] = cellText;
              if (cellText) hasData = true;
            } else {
              rowObj[key] = '';
            }
          }
          if (hasData) {
            parsed.rows.push(rowObj);
          }
        });
      }
    }
  }

  return parsed;
}

/**
 * High-level parse coordinator: cache-lookup -> LLM fallback -> auto-train
 */
async function parseStatusPage(html, portalType) {
  await ensureCacheInitialized();

  const layoutHash = generateLayoutHash(html, portalType);
  const cachedRules = inMemoryCache.get(layoutHash);

  if (cachedRules) {
    console.log(`[AI Parsing] Found cached layout mapping rules for hash: ${layoutHash}`);
    try {
      return parseUsingMapping(html, cachedRules);
    } catch (err) {
      console.error('[AI Parsing] Failed to parse using cached layout mappings, will retry with LLM:', err);
    }
  }

  console.log(`[AI Parsing] Layout hash ${layoutHash} not cached. Calling LiteLLM...`);
  const parsedData = await parseWithLLM(html, portalType);

  try {
    const trainedRules = autoTrainLayout(html, parsedData, portalType);
    inMemoryCache.set(layoutHash, trainedRules);
    await saveMapping(layoutHash, portalType, trainedRules);
    console.log(`[AI Parsing] Successfully trained and cached layout mapping for hash: ${layoutHash}`);
  } catch (trainErr) {
    console.error('[AI Parsing] Failed to auto-train layout mappings:', trainErr);
  }

  return parsedData;
}

async function saveMapping(layoutHash, portalType, mappingRules) {
  try {
    await db.run(
      `INSERT OR REPLACE INTO ai_layout_mappings (layout_hash, portal_type, mapping_rules)
       VALUES (?, ?, ?)`,
      [layoutHash, portalType, JSON.stringify(mappingRules)]
    );
  } catch (err) {
    console.error('[AI Parsing] Failed to write layout mapping to database:', err);
  }
}

module.exports = {
  generateLayoutHash,
  parseWithLLM,
  autoTrainLayout,
  parseUsingMapping,
  parseStatusPage,
  inMemoryCache
};
