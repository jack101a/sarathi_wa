const assert = require('assert');
const { parseFlowChoices } = require('../packages/common/src/interactiveFlowService');
const { redis, subscriber } = require('../packages/common/src/redis');

assert.deepStrictEqual(parseFlowChoices('1'), [1]);
assert.deepStrictEqual(parseFlowChoices('1,2'), [1, 2]);
assert.deepStrictEqual(parseFlowChoices('1 2'), [1, 2]);
assert.deepStrictEqual(parseFlowChoices('1+2/3'), [1, 2, 3]);

assert.deepStrictEqual(parseFlowChoices('2435332026 03-01-2008'), []);
assert.deepStrictEqual(parseFlowChoices('track 2435332026 03-01-2008'), []);
assert.deepStrictEqual(parseFlowChoices('03-01-2008'), []);
assert.deepStrictEqual(parseFlowChoices('Choose option 3'), []);

redis.disconnect();
subscriber.disconnect();

console.log('Interactive flow choice tests passed.');
