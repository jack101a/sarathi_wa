const crypto = require('crypto');
const { redis, config: CONFIG, logger } = require('@sarathi/common');

const COOKIE_NAME = 'sarathi_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

async function handleLogin(req, res) {
  const { username, token } = req.body || {};
  const expectedUser = CONFIG.ADMIN.USERNAME;
  const expectedToken = CONFIG.ADMIN.TOKEN;

  if (
    String(username || '').trim() !== expectedUser ||
    String(token || '').trim() !== expectedToken
  ) {
    logger.warn('adminAuth', 'Failed login attempt', { username });
    return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
  }

  const sessionToken = crypto.randomBytes(32).toString('hex');
  
  // Store session in Redis with 8 hours TTL
  await redis.setex(`adminsession:${sessionToken}`, 8 * 60 * 60, JSON.stringify({ createdAt: Date.now() }));

  res.cookie(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'strict',
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
