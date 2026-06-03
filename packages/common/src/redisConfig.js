const Redis = require('ioredis');

function getRedisConnectionConfig() {
  if (process.env.REDIS_HOST || process.env.REDIS_PASSWORD) {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    };
  }

  return process.env.REDIS_URL || 'redis://localhost:6379';
}

function createRedisClient(options = {}) {
  const connectionConfig = getRedisConnectionConfig();
  const clientOptions = {
    maxRetriesPerRequest: null,
    ...options,
  };

  if (typeof connectionConfig === 'string') {
    return new Redis(connectionConfig, clientOptions);
  }

  return new Redis({
    ...connectionConfig,
    ...clientOptions,
  });
}

module.exports = {
  createRedisClient,
  getRedisConnectionConfig,
};
