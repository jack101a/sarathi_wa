const CONFIG = require('../config/config');
const jobRepository = require('../services/jobRepository');
const logger = require('./logger');
const { run } = require('./db');
const { HEAVY_COMMANDS, recordRequest } = require('./rateLimiter');
const authRepo = require('../services/authorizationRepository');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class JobQueue {
  constructor(name, concurrency, options = {}) {
    this.name = name;
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.options = options;
    this.pending = [];
    this.running = new Set();
    this.completed = 0;
    this.failed = 0;
    this.handler = null;
    this.stopped = false;
  }

  process(handlerFn) { this.handler = handlerFn; }

  enqueue(job) {
    this.pending.push(job);
    this._tick().catch(() => {});
  }

  getStats() {
    return {
      name: this.name,
      pending: this.pending.length,
      running: this.running.size,
      completed: this.completed,
      failed: this.failed,
    };
  }

  async _runJob(job) {
    this.running.add(job.id);
    await jobRepository.updateJobStatus(job.id, 'running');
    try {
      if (this.options.delayMs > 0) await sleep(this.options.delayMs);
      if (!this.handler) throw new Error(`No handler for queue ${this.name}`);
      const result = await this.handler(job);
      await jobRepository.updateJobStatus(job.id, 'completed', JSON.stringify(result || {}), '');
      this.completed += 1;
      logger.debug('jobQueue', `Job completed`, { queue: this.name, jobId: job.id, command: job.command });

      // ── Credit deduction for heavy (professional) commands ──────────────────
      // Deducted ONLY on successful completion, not on failure/cancellation.
      if (HEAVY_COMMANDS.has(job.command) && job.user_id) {
        const cost = CONFIG.CREDIT_COST.heavy || 50;
        let deducted = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await authRepo.deductCreditsAudited(job.user_id, cost, `Heavy job completion: ${job.command}`, job.id);
            logger.info('jobQueue', `Deducted ${cost} credits from user ${job.user_id} for ${job.command}`);
            deducted = true;
            break;
          } catch (err) {
            logger.error('jobQueue', `Credit deduction attempt ${attempt}/3 failed for user ${job.user_id}`, { error: err.message });
            if (attempt < 3) await sleep(1000 * attempt);
          }
        }
        if (!deducted) {
          logger.error('jobQueue', `CRITICAL: Credit deduction FAILED after 3 attempts for user ${job.user_id}, job ${job.id}. Manual reconciliation needed.`);
          // Mark the job with billing failure for admin review
          try {
            await jobRepository.updateJobStatus(job.id, 'completed', JSON.stringify({ ...(result || {}), billing_failed: true }), '');
          } catch (_) {}
        }
      } else if (job.user_id) {
        // ── Rate Limit consumption for light/medium commands ─────────────────────
        try {
          await authRepo.incrementUsage(job.user_id);
          await recordRequest(job.user_id, job.command);
          logger.debug('jobQueue', `Recorded rate limit usage for user ${job.user_id}`, { command: job.command });
        } catch (err) {
          logger.error('jobQueue', `Failed to record rate limit for user ${job.user_id}`, { error: err.message });
        }
      }
    } catch (error) {
      const errMsg = error.message || String(error);
      await jobRepository.updateJobStatus(job.id, 'failed', '{}', errMsg);
      this.failed += 1;
      logger.warn('jobQueue', `Job failed`, { queue: this.name, jobId: job.id, command: job.command, error: errMsg });
    } finally {
      this.running.delete(job.id);
      this._tick().catch(() => {});
    }
  }

  async _tick() {
    if (this.stopped) return;
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this._runJob(job).catch(() => {});
    }
  }

  cancelPendingJob(jobId) {
    const idx = this.pending.findIndex(j => j.id === jobId);
    if (idx === -1) return false;
    this.pending.splice(idx, 1);
    return true;
  }

  stop() { this.stopped = true; }
}

const apiQueue     = new JobQueue('api',     CONFIG.QUEUE.API_CONCURRENCY);
const browserQueue = new JobQueue('browser', CONFIG.QUEUE.BROWSER_CONCURRENCY, {
  delayMs:     CONFIG.QUEUE.BROWSER_DELAY_MS,
  maxRetries:  CONFIG.QUEUE.BROWSER_MAX_RETRIES,
  backoffMs:   CONFIG.QUEUE.BROWSER_BACKOFF_MS,
});

/**
 * On startup, re-queue jobs that were interrupted by a crash.
 * Resets any 'running' jobs to 'pending' and loads them into memory queues.
 */
async function recoverJobs() {
  try {
    // Reset orphaned 'running' jobs back to 'pending'
    await run("UPDATE jobs SET status = 'pending', started_at = '' WHERE status = 'running'");

    const [apiPending, browserPending] = await Promise.all([
      jobRepository.getPendingJobs('api', 100),
      jobRepository.getPendingJobs('browser', 20),
    ]);

    for (const job of apiPending)     apiQueue.enqueue(job);
    for (const job of browserPending) browserQueue.enqueue(job);

    if (apiPending.length + browserPending.length > 0) {
      logger.info('jobQueue', `Recovered jobs after restart`, {
        api: apiPending.length,
        browser: browserPending.length,
      });
    }
  } catch (error) {
    logger.error('jobQueue', 'Job recovery failed', { error: error.message });
  }
}

module.exports = { apiQueue, browserQueue, JobQueue, recoverJobs };
