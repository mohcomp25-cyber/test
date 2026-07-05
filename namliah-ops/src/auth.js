'use strict';
const crypto = require('crypto');
const session = require('express-session');
const { db, audit } = require('./db');

// ---- scrypt password hashing (no external deps) ----

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// ---- SQLite-backed session store (survives restarts) ----

class SqliteStore extends session.Store {
  constructor() {
    super();
    this.get_ = db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires_at > ?');
    this.set_ = db.prepare(
      'INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at'
    );
    this.del_ = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.gc_ = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    setInterval(() => this.gc_.run(Date.now()), 60 * 60 * 1000).unref();
  }
  get(sid, cb) {
    try {
      const row = this.get_.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (err) { cb(err); }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) || 12 * 60 * 60 * 1000;
      this.set_.run(sid, JSON.stringify(sess), Date.now() + maxAge);
      cb(null);
    } catch (err) { cb(err); }
  }
  destroy(sid, cb) {
    try { this.del_.run(sid); cb(null); } catch (err) { cb(err); }
  }
}

function sessionMiddleware() {
  return session({
    store: new SqliteStore(),
    secret: process.env.SESSION_SECRET || 'namliah-dev-secret-change-me',
    name: 'namliah.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === '1',
      maxAge: 12 * 60 * 60 * 1000
    }
  });
}

// ---- role guards ----

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' });
}

// requireRole('ops') — admin also passes read-only GET requests so management
// can open any report view; writes stay restricted to the exact role.
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' });
    }
    if (req.session.role === role) return next();
    if (req.session.role === 'admin' && req.method === 'GET') return next();
    res.status(403).json({ error: 'forbidden', message: 'لا تملك صلاحية هذا الإجراء' });
  };
}

// ---- handlers ----

function login(req, res) {
  const { username, password } = req.body || {};
  const user = username
    ? db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim().toLowerCase())
    : null;
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'bad_credentials', message: 'بيانات الدخول غير صحيحة' });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.displayName = user.display_name;
  audit('login', user.id, { username: user.username });
  res.json({ role: user.role, displayName: user.display_name });
}

function logout(req, res) {
  req.session.destroy(() => res.json({ ok: true }));
}

function me(req, res) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  res.json({ role: req.session.role, displayName: req.session.displayName });
}

function changePassword(req, res) {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) {
    return res.status(400).json({ error: 'weak_password', message: 'كلمة المرور الجديدة يجب أن تكون ٨ أحرف على الأقل' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !verifyPassword(String(current || ''), user.password_hash)) {
    return res.status(401).json({ error: 'bad_credentials', message: 'كلمة المرور الحالية غير صحيحة' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(next)), user.id);
  audit('password_changed', user.id);
  res.json({ ok: true });
}

module.exports = {
  hashPassword,
  verifyPassword,
  sessionMiddleware,
  requireAuth,
  requireRole,
  login,
  logout,
  me,
  changePassword
};
