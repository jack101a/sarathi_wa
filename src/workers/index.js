require('./apiWorker');
require('./browserWorker');
const { apiQueue, browserQueue } = require('../core/jobQueue');
function startWorkers() { return true; }
async function stopWorkers() { apiQueue.stop(); browserQueue.stop(); }
module.exports = { startWorkers, stopWorkers };
