const CONFIG = require('../config/config');
const jobRepository = require('../services/jobRepository');

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
  enqueue(job) { this.pending.push(job); this._tick().catch(() => {}); }
  getStats() { return { pending: this.pending.length, running: this.running.size, completed: this.completed, failed: this.failed }; }

  async _runJob(job) {
    this.running.add(job.id);
    await jobRepository.updateJobStatus(job.id, 'running');
    try {
      if (this.options.delayMs > 0) await sleep(this.options.delayMs);
      if (!this.handler) throw new Error(`No handler for queue ${this.name}`);
      const result = await this.handler(job);
      await jobRepository.updateJobStatus(job.id, 'completed', JSON.stringify(result || {}), '');
      this.completed += 1;
    } catch (error) {
      await jobRepository.updateJobStatus(job.id, 'failed', '{}', error.message || String(error));
      this.failed += 1;
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

  stop() { this.stopped = true; }
}

const apiQueue = new JobQueue('api', CONFIG.QUEUE.API_CONCURRENCY);
const browserQueue = new JobQueue('browser', CONFIG.QUEUE.BROWSER_CONCURRENCY, { delayMs: CONFIG.QUEUE.BROWSER_DELAY_MS, maxRetries: CONFIG.QUEUE.BROWSER_MAX_RETRIES, backoffMs: CONFIG.QUEUE.BROWSER_BACKOFF_MS });

module.exports = { apiQueue, browserQueue, JobQueue };
