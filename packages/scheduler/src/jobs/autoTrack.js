const { queue, logger, jobRepository } = require('@sarathi/common');
const { apiQueue } = queue;

async function enqueueSystemJob(command, jobId, payload = {}) {
  const payloadJson = JSON.stringify(payload || {});
  await jobRepository.createJob({
    id: jobId,
    userId: null,
    userPhone: 'system',
    queueType: 'api',
    command,
    payloadJson,
    chatId: 'system',
    transport: 'system',
    dedupKey: jobId,
  });

  return apiQueue.add(command, {
    id: jobId,
    command,
    payload_json: payloadJson,
    chat_id: 'system',
    transport: 'system',
    user_phone: 'system',
    user_id: null,
  }, { jobId });
}

async function runAutoTrackSarathi() {
  logger.info('scheduler', 'Enqueuing Sarathi auto-track check to worker queue...');
  try {
    const jobId = `auto_track_sarathi__${new Date().toISOString().slice(0, 13).replace(/:/g, '-')}`;
    const job = await enqueueSystemJob('auto_track_check', jobId, { timestamp: Date.now() });
    logger.info('scheduler', `Sarathi auto-track check enqueued: job ID = ${job.id}`);
  } catch (err) {
    logger.error('scheduler', `Failed to enqueue Sarathi auto-track: ${err.stack}`);
  }
}

async function runAutoTrackVahan() {
  logger.info('scheduler', 'Enqueuing Vahan auto-track check to worker queue...');
  try {
    const jobId = `auto_track_vahan__${new Date().toISOString().slice(0, 13).replace(/:/g, '-')}`;
    const job = await enqueueSystemJob('vahan_track_check', jobId, { timestamp: Date.now() });
    logger.info('scheduler', `Vahan auto-track check enqueued: job ID = ${job.id}`);
  } catch (err) {
    logger.error('scheduler', `Failed to enqueue Vahan auto-track: ${err.stack}`);
  }
}

async function sendDailyStatusReports() {
  logger.info('scheduler', 'Enqueuing daily status reports job...');
  try {
    const jobId = `daily_reports__${new Date().toISOString().slice(0, 10)}`;
    const job = await enqueueSystemJob('daily_reports_check', jobId, { timestamp: Date.now() });
    logger.info('scheduler', `Daily status reports enqueued: job ID = ${job.id}`);
  } catch (err) {
    logger.error('scheduler', `Failed to enqueue daily status reports: ${err.stack}`);
  }
}

module.exports = {
  runAutoTrackSarathi,
  runAutoTrackVahan,
  sendDailyStatusReports
};
