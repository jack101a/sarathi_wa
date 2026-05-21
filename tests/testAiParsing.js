require('dotenv').config();

const assert = require('assert');
const cheerio = require('cheerio');
const aiParsingService = require('../src/services/aiParsingService');
const axios = require('axios');

// Mock axios post for LiteLLM
let mockLlmResponse = null;
let llmCallCount = 0;

const originalPost = axios.post;
axios.post = async function (url, data, config) {
  if (url.includes('/chat/completions')) {
    llmCallCount++;
    return {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify(mockLlmResponse)
            }
          }
        ]
      }
    };
  }
  return originalPost.call(axios, url, data, config);
};

// Mock config enabling AI parsing
const CONFIG = require('../src/config/config');
const originalAiEnabled = CONFIG.AI_PARSING.ENABLED;
CONFIG.AI_PARSING.ENABLED = true;

// Mock database to not write to real sqlite db for layoutMappings
const db = require('../src/core/db');
const originalDbRun = db.run;
const originalDbQuery = db.query;

let mockDb = {};
db.run = async (sql, params) => {
  if (sql.includes('INSERT OR REPLACE INTO ai_layout_mappings')) {
    mockDb[params[0]] = params[2]; // layout_hash -> mapping_rules
    return { lastID: 1, changes: 1 };
  }
  return originalDbRun(sql, params);
};
db.query = async (sql, params) => {
  if (sql.includes('SELECT mapping_rules FROM ai_layout_mappings')) {
    const hash = params[0];
    if (mockDb[hash]) {
      return [{ mapping_rules: mockDb[hash] }];
    }
    return [];
  }
  if (sql.includes('SELECT layout_hash, mapping_rules FROM ai_layout_mappings')) {
    return Object.entries(mockDb).map(([hash, rules]) => ({ layout_hash: hash, mapping_rules: rules }));
  }
  return originalDbQuery(sql, params);
};

async function runTests() {
  console.log('Running AI Parsing Tests...');

  // Test 1: generateLayoutHash strips dynamic data correctly
  const html1 = `
    <html>
      <body>
        <div>Application Number: MH26021234567</div>
        <div>Date: 12-Jan-2026</div>
        <table>
          <tr><td>Hypothecation Termination</td><td>APPROVED ON 27-Mar-2026 15:37:21</td></tr>
        </table>
      </body>
    </html>
  `;

  const html2 = `
    <html>
      <body>
        <div>Application Number: MH47BC5108234</div>
        <div>Date: 15-Feb-2026</div>
        <table>
          <tr><td>Hypothecation Termination</td><td>APPROVED ON 28-Mar-2026 10:11:12</td></tr>
        </table>
      </body>
    </html>
  `;

  const hash1 = aiParsingService.generateLayoutHash(html1, 'vahan');
  const hash2 = aiParsingService.generateLayoutHash(html2, 'vahan');

  assert.strictEqual(hash1, hash2, 'Layout hashes for identical layout with different data must be identical!');
  console.log('Pass: Layout hash is stable and ignores dynamic values.');

  // Test 2: parseStatusPage loops LLM -> Auto-Train -> Cache -> Mapped Parse
  const sarathiHtml = `
    <html>
      <body>
        <h3>Licence has been Approved.</h3>
        <table>
          <tr><td><b>Transaction:</b></td><td><b>ISSUE OF DL</b></td></tr>
          <tr><td><b>Current Stage:</b></td><td><b>APPROVAL OF DL</b></td></tr>
          <tr><td><b>Counter:</b></td><td><b>DL-APPROVAL-CO</b></td></tr>
        </table>
        <fieldset><legend>Completed Action(s)</legend>
          <table>
            <tr><td>SCRUTINY</td><td>COMPLETED</td><td>12-05-2026</td></tr>
            <tr><td>APPROVAL OF DL</td><td>COMPLETED</td><td>15-05-2026</td></tr>
          </table>
        </fieldset>
      </body>
    </html>
  `;

  mockLlmResponse = {
    applicantName: '',
    dlNumber: '',
    trackerNo: '',
    message: 'Licence has been Approved.',
    transaction: 'ISSUE OF DL',
    stage: 'APPROVAL OF DL',
    counter: 'DL-APPROVAL-CO',
    kind: 'approved',
    completedActions: [
      { actionName: 'SCRUTINY', status: 'COMPLETED', processedOn: '12-05-2026' },
      { actionName: 'APPROVAL OF DL', status: 'COMPLETED', processedOn: '15-05-2026' }
    ],
    furtherActions: []
  };

  llmCallCount = 0;
  
  // First run: Cache is empty. Should trigger LLM.
  const result1 = await aiParsingService.parseStatusPage(sarathiHtml, 'sarathi');
  assert.strictEqual(llmCallCount, 1, 'Expected LLM to be called on unrecognized layout.');
  assert.strictEqual(result1.transaction, 'ISSUE OF DL');
  assert.strictEqual(result1.completedActions.length, 2);
  assert.strictEqual(result1.completedActions[0].processedOn, '12-05-2026');

  // Verify rules are trained
  const sarathiHash = aiParsingService.generateLayoutHash(sarathiHtml, 'sarathi');
  assert.ok(aiParsingService.inMemoryCache.has(sarathiHash), 'Expected layout hash to be cached.');

  // Second run: layout is cached, should NOT call LLM.
  const sarathiHtml2 = `
    <html>
      <body>
        <h3>Licence has been Approved.</h3>
        <table>
          <tr><td><b>Transaction:</b></td><td><b>RENEWAL OF DL</b></td></tr>
          <tr><td><b>Current Stage:</b></td><td><b>APPROVAL OF DL</b></td></tr>
          <tr><td><b>Counter:</b></td><td><b>DL-APPROVAL-CO-2</b></td></tr>
        </table>
        <fieldset><legend>Completed Action(s)</legend>
          <table>
            <tr><td>SCRUTINY</td><td>COMPLETED</td><td>16-05-2026</td></tr>
            <tr><td>APPROVAL OF DL</td><td>COMPLETED</td><td>18-05-2026</td></tr>
          </table>
        </fieldset>
      </body>
    </html>
  `;

  const result2 = await aiParsingService.parseStatusPage(sarathiHtml2, 'sarathi');
  assert.strictEqual(llmCallCount, 1, 'Expected LLM NOT to be called on cached layout.');
  assert.strictEqual(result2.transaction, 'RENEWAL OF DL', 'Expected transaction to be Renewal');
  assert.strictEqual(result2.counter, 'DL-APPROVAL-CO-2', 'Expected counter to be DL-APPROVAL-CO-2');
  assert.strictEqual(result2.completedActions.length, 2, 'Expected 2 completed actions');
  assert.strictEqual(result2.completedActions[0].processedOn, '16-05-2026', 'Expected first action date to be 16-05-2026');
  
  console.log('Pass: parseStatusPage coordinates training, caching, and direct extraction works perfectly.');

  // Cleanup mocks
  axios.post = originalPost;
  db.run = originalDbRun;
  db.query = originalDbQuery;
  CONFIG.AI_PARSING.ENABLED = originalAiEnabled;
  console.log('All tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
