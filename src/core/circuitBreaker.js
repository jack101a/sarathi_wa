/**
 * Circuit breaker responsibility:
 * Wrap external calls. After N consecutive failures, open the circuit
 * for M seconds to prevent cascading failures.
 */

const logger = require('./logger');

class CircuitBreaker {
  /**
   * @param {string} name
   * @param {{ failureThreshold?: number, resetTimeoutMs?: number }} options
   */
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs   = options.resetTimeoutMs   || 30_000;
    this.state            = 'closed'; // 'closed' | 'open' | 'half-open'
    this.failureCount     = 0;
    this.lastFailureTime  = 0;
  }

  /** Execute a function through the circuit breaker. */
  async execute(fn) {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'half-open';
        logger.info('circuitBreaker', `Circuit ${this.name} → half-open (testing)`);
      } else {
        throw new Error(`Circuit ${this.name} is OPEN — upstream unavailable, retrying in ${Math.ceil((this.resetTimeoutMs - elapsed) / 1000)}s`);
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    if (this.state !== 'closed') {
      logger.info('circuitBreaker', `Circuit ${this.name} → closed`);
    }
    this.failureCount = 0;
    this.state = 'closed';
  }

  _onFailure(err) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      logger.warn('circuitBreaker', `Circuit ${this.name} → OPEN after ${this.failureCount} failures`, {
        lastError: err.message,
      });
    }
  }

  getState() {
    return { name: this.name, state: this.state, failureCount: this.failureCount };
  }
}

// Shared circuit breakers for external services
const sarathiBreaker = new CircuitBreaker('sarathi-api', { failureThreshold: 5, resetTimeoutMs: 30_000 });
const vahanBreaker   = new CircuitBreaker('vahan-api',   { failureThreshold: 5, resetTimeoutMs: 30_000 });

module.exports = { CircuitBreaker, sarathiBreaker, vahanBreaker };
