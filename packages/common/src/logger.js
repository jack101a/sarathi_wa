/**
 * Logger responsibility:
 * Structured JSON logging with levels. Replaces scattered console.log/error calls.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 1;

function log(level, module, message, meta = {}) {
  if ((LEVELS[level] ?? 0) < currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    module: String(module || 'app'),
    msg: String(message || ''),
    ...meta,
  };
  const out = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(out + '\n');
  } else {
    process.stdout.write(out + '\n');
  }
}

module.exports = {
  debug: (mod, msg, meta) => log('debug', mod, msg, meta),
  info:  (mod, msg, meta) => log('info',  mod, msg, meta),
  warn:  (mod, msg, meta) => log('warn',  mod, msg, meta),
  error: (mod, msg, meta) => log('error', mod, msg, meta),
};
