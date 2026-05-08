/**
 * Admin auth responsibility:
 * Simple token-based auth via HTTP-only cookie for the admin dashboard.
 */

const crypto = require('crypto');
const CONFIG = require('../config/config');
const logger = require('../core/logger');

const COOKIE_NAME = 'sarathi_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// In-memory session store: token -> { createdAt }
const sessions = new Map();

function _generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function _pruneExpired() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [token, data] of sessions) {
    if (data.createdAt < cutoff) sessions.delete(token);
  }
}

/** POST /admin/api/login handler */
async function handleLogin(req, res) {
  const { username, token } = req.body || {};
  const expectedUser  = CONFIG.ADMIN.USERNAME;
  const expectedToken = CONFIG.ADMIN.TOKEN;

  if (
    String(username  || '').trim() !== expectedUser  ||
    String(token     || '').trim() !== expectedToken
  ) {
    logger.warn('adminAuth', 'Failed login attempt', { username });
    return res.status(401).json({ ok: false, message: 'Invalid credentials.' });
  }

  _pruneExpired();
  const sessionToken = _generateToken();
  sessions.set(sessionToken, { createdAt: Date.now() });

  res.cookie(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: SESSION_TTL_MS,
    path: '/admin',
  });

  logger.info('adminAuth', 'Admin logged in', { username });
  return res.json({ ok: true });
}

/** POST /admin/api/logout handler */
function handleLogout(req, res) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) sessions.delete(token);
  res.clearCookie(COOKIE_NAME, { path: '/admin' });
  return res.json({ ok: true });
}

/** Express middleware — rejects requests without a valid session cookie */
function requireAdminAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ ok: false, message: 'Not authenticated.' });

  const session = sessions.get(token);
  if (!session) return res.status(401).json({ ok: false, message: 'Session expired.' });

  const age = Date.now() - session.createdAt;
  if (age > SESSION_TTL_MS) {
    sessions.delete(token);
    return res.status(401).json({ ok: false, message: 'Session expired.' });
  }

  next();
}

/** GET /admin/api/verify — check if currently authenticated */
function handleVerify(req, res) {
  return res.json({ ok: true, authenticated: true });
}

module.exports = { handleLogin, handleLogout, handleVerify, requireAdminAuth };
