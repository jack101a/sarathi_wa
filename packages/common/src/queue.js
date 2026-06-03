const { Queue } = require('bullmq');
const CONFIG = require('./config');
const { createRedisClient } = require('./redisConfig');

const connection = createRedisClient();

const API_QUEUE_NAME = process.env.API_QUEUE_NAME || 'sarathi-api-jobs';
const BROWSER_QUEUE_NAME = process.env.BROWSER_QUEUE_NAME || 'sarathi-browser-jobs';

const apiQueue = new Queue(API_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

const browserQueue = new Queue(BROWSER_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: CONFIG.QUEUE.BROWSER_MAX_RETRIES || 2,
    backoff: {
      type: 'exponential',
      delay: CONFIG.QUEUE.BROWSER_BACKOFF_MS || 5000,
    },
  },
});

module.exports = {
  apiQueue,
  browserQueue,
  connection,
  API_QUEUE_NAME,
  BROWSER_QUEUE_NAME,
};
