const { logger } = require('@sarathi/common');

function apiNotFound(req, res) {
  res.status(404).json({
    ok: false,
    message: 'API route not found',
    requestId: res.locals.requestId,
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = Number(err.statusCode || err.status || 500);
  const safeStatus = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
  const isServerError = safeStatus >= 500;

  logger.error('api.error', err.message || 'Unhandled API error', {
    requestId: res.locals.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode: safeStatus,
    stack: err.stack,
  });

  res.status(safeStatus).json({
    ok: false,
    message: isServerError ? 'Internal server error' : err.message,
    requestId: res.locals.requestId,
  });
}

module.exports = {
  apiNotFound,
  errorHandler,
};
