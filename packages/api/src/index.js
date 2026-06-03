const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { config: CONFIG, logger, db, redis } = require('@sarathi/common');

async function main() {
  console.log('[API] Starting API server...');
  const app = express();
  
  app.use(cookieParser());
  app.use(express.json({
    verify: (req, _res, buf) => {
      if (req.originalUrl === '/admin/api/payments/razorpay/webhook') {
        req.rawBody = Buffer.from(buf);
      }
    },
  }));

  // Mount Admin API routes
  const adminRouter = require('./routes/adminRouter');
  app.use('/admin/api', adminRouter);

  // Expose health status
  app.get('/health', async (req, res) => {
    const checks = { db: 'unknown', redis: 'unknown' };
    try {
      await db.query('SELECT 1');
      checks.db = 'ok';
    } catch (err) {
      checks.db = 'error';
    }
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch (err) {
      checks.redis = 'error';
    }
    const healthy = checks.db === 'ok' && checks.redis === 'ok';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks,
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
    });
  });

  // Serve compiled admin frontend React files
  const frontendDist = path.resolve(__dirname, '../../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use('/admin', express.static(frontendDist));
    app.get('/admin/*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
    logger.info('api', 'Admin frontend served from frontend/dist');
  } else {
    app.get('/admin*', (_req, res) => res.status(503).send('Admin frontend not built. Run: npm run build:frontend'));
    logger.warn('api', 'Admin frontend dist not found — serving fallback placeholder');
  }

  const port = process.env.PORT || CONFIG.PORT || 3000;
  const server = app.listen(port, () => {
    logger.info('api', `HTTP server listening on port ${port}`, {
      adminUrl: `http://localhost:${port}/admin`,
      healthUrl: `http://localhost:${port}/health`,
    });
  });

  const handleShutdown = async (signal) => {
    console.log(`[API] Received ${signal}. Shutting down server...`);
    server.close(async () => {
      await db.close().catch(() => {});
      console.log('[API] Server closed.');
      process.exit(0);
    });
  };

  process.once('SIGINT', () => handleShutdown('SIGINT'));
  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`[API] Fatal startup error: ${err.stack}`);
  process.exit(1);
});
