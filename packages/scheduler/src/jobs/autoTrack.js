const { queue, logger } = require('@sarathi/common');
const { apiQueue } = queue;

async function runAutoTrackSarathi() {
  logger.info('scheduler', 'Enqueuing Sarathi auto-track check to worker queue...');
  try {
    const job = await apiQueue.add('auto_track_check', {
      timestamp: Date.now()
    }, {
      jobId: `auto_track_sarathi__${new Date().toISOString().slice(0, 13).replace(/:/g, '-')}` // dedup hourly
    });
    logger.info('scheduler', `Sarathi auto-track check enqueued: job ID = ${job.id}`);
  } catch (err) {
    logger.error('scheduler', `Failed to enqueue Sarathi auto-track: ${err.stack}`);
  }
}

async function runAutoTrackVahan() {
  logger.info('scheduler', 'Enqueuing Vahan auto-track check to worker queue...');
  try {
    const job = await apiQueue.add('vahan_track_check', {
      timestamp: Date.now()
    }, {
      jobId: `auto_track_vahan__${new Date().toISOString().slice(0, 13).replace(/:/g, '-')}` // dedup hourly
    });
    logger.info('scheduler', `Vahan auto-track check enqueued: job ID = ${job.id}`);
  } catch (err) {
    logger.error('scheduler', `Failed to enqueue Vahan auto-track: ${err.stack}`);
  }
}

async function sendDailyStatusReports() {
  logger.info('scheduler', 'Enqueuing daily status reports job...');
  try {
    const job = await apiQueue.add('daily_reports_check', {
      timestamp: Date.now()
    }, {
      jobId: `daily_reports__${new Date().toISOString().slice(0, 10)}` // dedup daily
    });
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
