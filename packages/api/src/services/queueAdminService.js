'use strict';

function createQueueAdminService({ jobRepository, logger }) {
  if (!jobRepository || typeof jobRepository.cancelJobs !== 'function') {
    throw new Error('jobRepository.cancelJobs is required');
  }

  async function flushQueue(queue) {
    const wasPaused = await queue.isPaused();
    if (!wasPaused) await queue.pause();

    try {
      const jobs = (await queue.getJobs(
        ['waiting', 'delayed', 'prioritized', 'paused'],
        0,
        -1,
        true
      )).filter(Boolean);
      const removedJobIds = [];

      for (const job of jobs) {
        try {
          await job.remove();
          removedJobIds.push(String(job.id));
        } catch (err) {
          logger?.warn('queueAdminService', 'Failed to remove queued job during flush', {
            queue: queue.name,
            jobId: job.id,
            error: err.message,
          });
        }
      }

      const reconciliation = await jobRepository.cancelJobs(removedJobIds);
      return {
        removed: removedJobIds.length,
        cancelled: reconciliation.cancelledIds.length,
        releasedCredits: reconciliation.releasedCredits,
      };
    } finally {
      if (!wasPaused) await queue.resume();
    }
  }

  async function removePendingJob(queues, jobId) {
    let found = false;
    let removed = false;

    for (const queue of queues) {
      const job = await queue.getJob(jobId);
      if (!job) continue;
      found = true;
      try {
        await job.remove();
        removed = true;
      } catch (err) {
        logger?.warn('queueAdminService', 'Refused to cancel non-removable queue job', {
          queue: queue.name,
          jobId,
          error: err.message,
        });
        return { found: true, removed: false, error: err };
      }
    }

    return { found, removed, error: null };
  }

  return { flushQueue, removePendingJob };
}

module.exports = { createQueueAdminService };
