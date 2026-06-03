require('dotenv').config();
const { createRedisClient } = require('./redisConfig');

const redis = createRedisClient();
const subscriber = createRedisClient();

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

subscriber.on('error', (err) => {
  console.error('Redis subscriber connection error:', err.message);
});

module.exports = { redis, subscriber };
