const { randomUUID } = require('crypto');
const { logger } = require('@sarathi/common');

function requestContext(req, res, next) {
  const startedAt = Date.now();
  const requestId = req.headers['x-request-id'] || randomUUID();

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const meta = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    };

    if (res.statusCode >= 500) {
      logger.error('api.request', 'Request completed with server error', meta);
    } else if (res.statusCode >= 400) {
      logger.warn('api.request', 'Request completed with client error', meta);
    } else {
      logger.debug('api.request', 'Request completed', meta);
    }
  });

  next();
}

module.exports = requestContext;
