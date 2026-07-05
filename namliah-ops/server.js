'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');

const { sessionMiddleware, login, logout, me, changePassword, requireAuth } = require('./src/auth');
const webhookRouter = require('./src/routes/webhook');
const opsRouter = require('./src/routes/ops');
const adminRouter = require('./src/routes/admin');
const reviewsRouter = require('./src/routes/reviews');
const exportRouter = require('./src/routes/exportReport');
const scheduler = require('./src/scheduler');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// Webhook has no session (machine-to-machine, secret header auth)
app.use('/api/webhook', webhookRouter);

app.use(sessionMiddleware());

// Auth
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/me', me);
app.post('/api/auth/password', requireAuth, changePassword);

// APIs
app.use('/api/ops', opsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/report', exportRouter);

// Pages
const pub = path.join(__dirname, 'public');
const send = (file) => (req, res) => res.sendFile(path.join(pub, file));
const requirePage = (role) => (req, res, next) => {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  if (role && req.session.role !== role && req.session.role !== 'admin') return res.redirect('/');
  next();
};

app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.sendFile(path.join(pub, 'login.html'));
});
app.get('/ops', requirePage('ops'), send('ops.html'));
app.get('/dashboard', requirePage('admin'), send('dashboard.html'));
app.get('/', (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  res.redirect(req.session.role === 'admin' ? '/dashboard' : '/ops');
});

app.use(express.static(pub));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.type === 'entity.parse.failed' ? 400 : 500)
    .json({ error: 'server_error', message: 'حدث خطأ غير متوقع' });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`منصة عمليات نملية تعمل على http://localhost:${PORT}`);
  const hasAnySecret = process.env.WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET_JEDDAH || process.env.WEBHOOK_SECRET_ABHA || process.env.WEBHOOK_SECRET_MAKKAH;
  if (!hasAnySecret) {
    console.warn('تنبيه: لا يوجد مفتاح webhook لأي فرع (WEBHOOK_SECRET_JEDDAH/_ABHA/_MAKKAH) — نقطة استقبال المبيعات سترفض كل الطلبات (401)');
  }
  scheduler.start();
});
