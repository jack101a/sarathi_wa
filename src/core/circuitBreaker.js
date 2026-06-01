/**
 * Circuit breaker responsibility:
 * Wrap external calls. After N consecutive failures, open the circuit
 * for M seconds to prevent cascading failures.
 * Distributed via Redis to share state across multiple servers.
 */

const { redis } = require('./redis');
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
  }

  async _loadState() {
    try {
      const data = await redis.hgetall(`circuit:${this.name}`);
      return {
        name: this.name,
        state: data.state || 'closed',
        failureCount: parseInt(data.failureCount, 10) || 0,
        lastFailureTime: parseInt(data.lastFailureTime, 10) || 0,
      };
    } catch (e) {
      // Fallback to safe defaults if Redis fails
      return { name: this.name, state: 'closed', failureCount: 0, lastFailureTime: 0 };
    }
  }

  async _saveState(state, failureCount, lastFailureTime) {
    try {
      await redis.hset(`circuit:${this.name}`, {
        state,
        failureCount: String(failureCount),
        lastFailureTime: String(lastFailureTime),
      });
    } catch (e) {
      console.error(`[circuitBreaker] Failed to save state for ${this.name}:`, e.message);
    }
  }

  /** Execute a function through the circuit breaker. */
  async execute(fn) {
    let { state, failureCount, lastFailureTime } = await this._loadState();

    if (state === 'open') {
      const elapsed = Date.now() - lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        state = 'half-open';
        await this._saveState(state, failureCount, lastFailureTime);
        logger.info('circuitBreaker', `Circuit ${this.name} → half-open (testing)`);
      } else {
        throw new Error(`Circuit ${this.name} is OPEN — upstream unavailable, retrying in ${Math.ceil((this.resetTimeoutMs - elapsed) / 1000)}s`);
      }
    }

    try {
      const result = await fn();
      await this._onSuccess(state);
      return result;
    } catch (err) {
      await this._onFailure(state, failureCount, err);
      throw err;
    }
  }

  async _onSuccess(currentState) {
    if (currentState !== 'closed') {
      logger.info('circuitBreaker', `Circuit ${this.name} → closed`);
    }
    await this._saveState('closed', 0, 0);
  }

  async _onFailure(currentState, currentFailureCount, err) {
    const nextFailureCount = currentFailureCount + 1;
    const nextFailureTime = Date.now();
    let nextState = currentState;
    if (nextFailureCount >= this.failureThreshold) {
      nextState = 'open';
      logger.warn('circuitBreaker', `Circuit ${this.name} → OPEN after ${nextFailureCount} failures`, {
        lastError: err.message,
      });
    }
    await this._saveState(nextState, nextFailureCount, nextFailureTime);
  }

  async getState() {
    return this._loadState();
  }
}

// Shared circuit breakers for external services
const sarathiBreaker = new CircuitBreaker('sarathi-api', { failureThreshold: 5, resetTimeoutMs: 30_000 });
const vahanBreaker   = new CircuitBreaker('vahan-api',   { failureThreshold: 5, resetTimeoutMs: 30_000 });

module.exports = { CircuitBreaker, sarathiBreaker, vahanBreaker };
