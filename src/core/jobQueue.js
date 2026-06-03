const { Queue, Worker } = require('bullmq');
const { createRedisClient } = require('@sarathi/common/src/redisConfig');
const CONFIG = require('../config/config');
const { redis } = require('./redis');

class JobQueue {
  constructor(name, concurrency, options = {}) {
    this.name = name;
    this.concurrency = concurrency;
    this.options = options;
    
    this.connection = createRedisClient();
    
    this.queue = new Queue(this.name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: options.maxRetries || 1,
        backoff: {
          type: 'exponential',
          delay: options.backoffMs || 5000,
        },
      },
    });

    this.worker = null;
    this.completedCount = 0;
    this.failedCount = 0;
  }

  async enqueue(job) {
    return this.queue.add(job.command, job, {
      jobId: job.id,
      priority: job.priority || 0,
      delay: this.options.delayMs || 0,
    });
  }

  process(handlerFn) {
    const workerConnection = createRedisClient();
    
    this.worker = new Worker(this.name, async (bullJob) => {
      const job = bullJob.data;
      const jobRepository = require('../services/jobRepository');
      const logger = require('./logger');
      const { isHeavyCommand, getCreditCost, recordRequest } = require('./rateLimiter');
      const authRepo = require('../services/authorizationRepository');

      await jobRepository.updateJobStatus(job.id, 'running');
      
      try {
        const result = await handlerFn(job);
        await jobRepository.updateJobStatus(job.id, 'completed', JSON.stringify(result || {}), '');
        this.completedCount++;
        
        // ── Credit deduction / Rate Limit consumption ──────────────────
        if (isHeavyCommand(job.command) && job.user_id) {
          const cost = getCreditCost(job.command);
          let deducted = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await authRepo.deductCreditsAudited(job.user_id, cost, `Heavy job completion: ${job.command}`, job.id);
              logger.info('jobQueue', `Deducted ${cost} credits from user ${job.user_id} for ${job.command}`);
              deducted = true;
              break;
            } catch (err) {
              logger.error('jobQueue', `Credit deduction attempt ${attempt}/3 failed for user ${job.user_id}`, { error: err.message });
              if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
            }
          }
          if (!deducted) {
            logger.error('jobQueue', `CRITICAL: Credit deduction FAILED after 3 attempts for user ${job.user_id}, job ${job.id}. Manual reconciliation needed.`);
            try {
              await jobRepository.updateJobStatus(job.id, 'completed', JSON.stringify({ ...(result || {}), billing_failed: true }), '');
            } catch (_) {}
          }
        } else if (job.user_id) {
          try {
            await authRepo.incrementUsage(job.user_id);
            await recordRequest(job.user_id, job.command);
          } catch (err) {
            logger.error('jobQueue', `Failed to record rate limit for user ${job.user_id}`, { error: err.message });
          }
        }

        return result;
      } catch (error) {
        const errMsg = error.message || String(error);
        await jobRepository.updateJobStatus(job.id, 'failed', '{}', errMsg);
        this.failedCount++;
        throw error;
      }
    }, {
      connection: workerConnection,
      concurrency: this.concurrency,
    });

    this.worker.on('failed', (bullJob, err) => {
      const logger = require('./logger');
      logger.warn('jobQueue', `BullMQ job failed`, { queue: this.name, jobId: bullJob ? bullJob.id : 'unknown', error: err.message });
    });
  }

  async getStats() {
    const [pending, active, completed, failed] = await Promise.all([
      this.queue.getJobCountByTypes('waiting', 'delayed'),
      this.queue.getJobCountByTypes('active'),
      this.queue.getJobCountByTypes('completed'),
      this.queue.getJobCountByTypes('failed'),
    ]);

    return {
      name: this.name,
      pending,
      running: active,
      completed: completed + this.completedCount,
      failed: failed + this.failedCount,
    };
  }

  async close() {
    if (this.worker) {
      await this.worker.close();
    }
    await this.queue.close();
    await this.connection.quit();
  }
}

const apiQueue     = new JobQueue('api',     CONFIG.QUEUE.API_CONCURRENCY || 5);
const browserQueue = new JobQueue('browser', CONFIG.QUEUE.BROWSER_CONCURRENCY || 1, {
  delayMs:     CONFIG.QUEUE.BROWSER_DELAY_MS || 3000,
  maxRetries:  CONFIG.QUEUE.BROWSER_MAX_RETRIES || 2,
  backoffMs:   CONFIG.QUEUE.BROWSER_BACKOFF_MS || 5000,
});

async function recoverJobs() {
  const { run } = require('./db');
  const jobRepository = require('../services/jobRepository');
  const logger = require('./logger');

  try {
    // Reset orphaned 'running' jobs back to 'pending' in database
    await run("UPDATE jobs SET status = 'pending', started_at = '' WHERE status = 'running'");

    const [apiPending, browserPending] = await Promise.all([
      jobRepository.getPendingJobs('api', 100),
      jobRepository.getPendingJobs('browser', 20),
    ]);

    for (const job of apiPending)     await apiQueue.enqueue(job);
    for (const job of browserPending) await browserQueue.enqueue(job);

    if (apiPending.length + browserPending.length > 0) {
      logger.info('jobQueue', `Recovered and enqueued jobs after restart`, {
        api: apiPending.length,
        browser: browserPending.length,
      });
    }
  } catch (error) {
    logger.error('jobQueue', 'Job recovery failed', { error: error.message });
  }
}

module.exports = { apiQueue, browserQueue, JobQueue, recoverJobs };
