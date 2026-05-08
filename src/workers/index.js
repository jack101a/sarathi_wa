const { apiWorker }     = require('./apiWorker');
const { browserWorker, getLlprintSessions } = require('./browserWorker');
const { apiQueue, browserQueue, recoverJobs } = require('../core/jobQueue');
const logger = require('../core/logger');

async function startWorkers() {
  await recoverJobs();
  logger.info('workers', 'Workers started', {
    apiConcurrency:     apiQueue.concurrency,
    browserConcurrency: browserQueue.concurrency,
  });
  return true;
}

async function stopWorkers() {
  apiQueue.stop();
  browserQueue.stop();
  logger.info('workers', 'Workers stopped');
}

module.exports = { startWorkers, stopWorkers, getLlprintSessions };
