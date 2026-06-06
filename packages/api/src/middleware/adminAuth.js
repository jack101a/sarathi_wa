const crypto = require('crypto');
const { redis, config: CONFIG, logger } = require('@sarathi/common');

const COOKIE_NAME = 'sarathi_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 8;

function safeEquals(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyPasswordHash(password, expectedHash) {
  const hash = String(expectedHash || '').trim();
  if (!hash) return false;

  if (hash.startsWith('scrypt:')) {
    const [, saltHex, keyHex] = hash.split(':');
    if (!saltHex || !keyHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const supplied = crypto.scryptSync(String(password || ''), salt, expected.length);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }

  const suppliedHash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
  return safeEquals(suppliedHash, hash) || safeEquals(`sha256:${suppliedHash}`, hash);
}

async function handleLogin(req, res) {
  const { username, password, token } = req.body || {};
  const expectedUser = CONFIG.ADMIN.USERNAME;
  const remoteId = String(req.ip || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const failKey = `adminlogin:fail:${remoteId}`;

  const failedCount = Number(await redis.get(failKey).catch(() => 0) || 0);
  if (failedCount >= LOGIN_MAX_FAILURES) {
    return res.status(429).json({ ok: false, message: 'Too many login attempts. Try again later.' });
  }

  const suppliedPassword = String(password || token || '').trim();
  const expectedPassword = CONFIG.ADMIN.PASSWORD || CONFIG.ADMIN.TOKEN;
  const expectedHash = CONFIG.ADMIN.PASSWORD_HASH;
  let credentialsOk = String(username || '').trim() === expectedUser;

  if (credentialsOk) {
    if (expectedHash) {
      credentialsOk = verifyPasswordHash(suppliedPassword, expectedHash);
    } else {
      credentialsOk = Boolean(expectedPassword) && safeEquals(suppliedPassword, expectedPassword);
    }
  }

  if (!credentialsOk) {
    await redis.multi().incr(failKey).expire(failKey, LOGIN_WINDOW_SECONDS).exec().catch(() => {});
    logger.warn('adminAuth', 'Failed login attempt', { username });
    return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
  }

  await redis.del(failKey).catch(() => {});
  const sessionToken = crypto.randomBytes(32).toString('hex');
  
  // Store session in Redis with 8 hours TTL
  await redis.setex(`adminsession:${sessionToken}`, 8 * 60 * 60, JSON.stringify({ createdAt: Date.now() }));

  res.cookie(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: CONFIG.APP_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/admin',
  });

  logger.info('adminAuth', 'Admin logged in', { username });
  return res.json({ ok: true });
}

async function handleLogout(req, res) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    await redis.del(`adminsession:${token}`).catch(() => {});
  }
  res.clearCookie(COOKIE_NAME, { path: '/admin' });
  return res.json({ ok: true });
}

async function requireAdminAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ ok: false, message: 'Not authenticated.' });

  try {
    const sessionRaw = await redis.get(`adminsession:${token}`);
    if (!sessionRaw) return res.status(401).json({ ok: false, message: 'Session expired.' });

    const session = JSON.parse(sessionRaw);
    const age = Date.now() - session.createdAt;
    if (age > SESSION_TTL_MS) {
      await redis.del(`adminsession:${token}`).catch(() => {});
      return res.status(401).json({ ok: false, message: 'Session expired.' });
    }

    next();
  } catch (err) {
    logger.error('adminAuth', 'Auth middleware error', { error: err.stack });
    return res.status(500).json({ ok: false, message: 'Internal authentication error.' });
  }
}

function handleVerify(req, res) {
  return res.json({ ok: true, authenticated: true });
}

module.exports = { handleLogin, handleLogout, handleVerify, requireAdminAuth };
