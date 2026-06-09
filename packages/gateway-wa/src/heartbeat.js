const { redis } = require('@sarathi/common');

const INSTANCE_ID = process.env.INSTANCE_ID || 'wa-primary';
const INSTANCE_ROLE = process.env.INSTANCE_ROLE || 'primary';

let heartbeatInterval = null;
let failoverCheckInterval = null;

async function startHeartbeat() {
  // If we are primary, set ourselves active immediately at start if not already set
  if (INSTANCE_ROLE === 'primary') {
    try {
      await redis.setnx('wa:active', INSTANCE_ID);
    } catch (err) {
      console.error(`[Heartbeat] Initial active lock set failed: ${err.message}`);
    }
  }

  // Heartbeat loop every 10 seconds
  heartbeatInterval = setInterval(async () => {
    try {
      const key = `wa:heartbeat:${INSTANCE_ROLE}`;
      await redis.setex(key, 30, 'alive');
      
      if (INSTANCE_ROLE === 'primary') {
        const currentActive = await redis.get('wa:active');
        if (currentActive !== INSTANCE_ID) {
          console.log(`[Primary] Reclaiming active status from ${currentActive || 'none'}.`);
          await redis.set('wa:active', INSTANCE_ID);
        }
      }
    } catch (err) {
      console.error(`[Heartbeat] Failed to write heartbeat: ${err.message}`);
    }
  }, 10000);

  // If we are failover, check primary status every 15 seconds
  if (INSTANCE_ROLE === 'failover') {
    failoverCheckInterval = setInterval(async () => {
      try {
        const primaryAlive = await redis.get('wa:heartbeat:primary');
        if (!primaryAlive) {
          const currentActive = await redis.get('wa:active');
          if (currentActive !== INSTANCE_ID) {
            console.log(`[Failover] Primary heartbeat lost! Promoting failover (${INSTANCE_ID}) to active.`);
            await redis.set('wa:active', INSTANCE_ID);
          }
        }
      } catch (err) {
        console.error(`[Failover] Failed to check primary status: ${err.message}`);
      }
    }, 15000);
  }
}

async function isInstanceActive() {
  try {
    const active = await redis.get('wa:active');
    // If nothing set, default to primary
    if (!active) {
      return INSTANCE_ROLE === 'primary';
    }
    return active === INSTANCE_ID;
  } catch (err) {
    console.error(`[Heartbeat] Failed to check active status: ${err.message}`);
    // Safe fallback to role
    return INSTANCE_ROLE === 'primary';
  }
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (failoverCheckInterval) clearInterval(failoverCheckInterval);
}

module.exports = {
  startHeartbeat,
  isInstanceActive,
  stopHeartbeat,
  INSTANCE_ID,
  INSTANCE_ROLE
};
