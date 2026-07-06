'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { db, getSetting, BRANCHES, DEFAULT_BRANCH } = require('../db');
const apify = require('../services/apify');

const router = express.Router();
router.use(requireAuth);

const PAGE_SIZE = 12;

// فرع المستخدم: مدير التشغيل مقيد بفرعه؛ الإدارة تحدد ?branch= أو ترى الكل
function reqBranch(req) {
  if (req.session.role === 'ops') return req.session.branch || DEFAULT_BRANCH;
  const b = req.query.branch;
  return BRANCHES[b] ? b : 'all';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', (req, res) => {
  const branch = reqBranch(req);
  const sentiment = ['positive', 'neutral', 'negative'].includes(req.query.sentiment)
    ? req.query.sentiment : null;
  // فلتر يوم العمل: يعرض كل مراجعات ذلك اليوم بلا ترقيم صفحات
  const date = DATE_RE.test(req.query.date || '') ? req.query.date : null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const conds = [];
  const params = [];
  if (branch !== 'all') { conds.push('branch = ?'); params.push(branch); }
  if (sentiment) { conds.push('sentiment = ?'); params.push(sentiment); }
  if (date) { conds.push('review_date = ?'); params.push(date); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM reviews ${where}`).get(...params).c;
  const limit = date ? 200 : PAGE_SIZE;
  const offset = date ? 0 : (page - 1) * PAGE_SIZE;
  const rows = db.prepare(`
    SELECT external_id, branch, author_name, author_photo_url, rating, text, review_date, photos, owner_reply, sentiment
    FROM reviews ${where}
    ORDER BY review_date DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({
    page: date ? 1 : page,
    pages: date ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    branch,
    date,
    reviews: rows.map((r) => ({ ...r, photos: JSON.parse(r.photos || '[]') }))
  });
});

router.get('/stats', (req, res) => {
  const branch = reqBranch(req);
  const where = branch === 'all' ? '' : 'WHERE branch = ?';
  const args = branch === 'all' ? [] : [branch];
  const stats = db.prepare(`
    SELECT COUNT(*) AS count, AVG(rating) AS avg_rating,
      SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS star5,
      SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS star4,
      SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS star3,
      SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS star2,
      SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS star1,
      SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative
    FROM reviews ${where}
  `).get(...args);
  const syncBranch = branch === 'all' ? DEFAULT_BRANCH : branch;
  res.json({
    ...stats,
    branch,
    configured: apify.isConfigured(syncBranch),
    sync_running: getSetting(`reviews_sync_running:${syncBranch}`) === '1',
    last_sync_at: getSetting(`last_reviews_sync_at:${syncBranch}`),
    last_sync_status: getSetting(`last_reviews_sync_status:${syncBranch}`)
  });
});

router.post('/sync', (req, res) => {
  const branch = reqBranch(req) === 'all' ? DEFAULT_BRANCH : reqBranch(req);
  if (!apify.isConfigured(branch)) {
    return res.status(400).json({
      error: 'not_configured',
      message: `مزامنة مراجعات فرع ${BRANCHES[branch]} غير مُفعّلة — أضف APIFY_TOKEN و GOOGLE_MAPS_URL_${branch.toUpperCase()} في ملف .env`
    });
  }
  if (getSetting(`reviews_sync_running:${branch}`) === '1') {
    return res.status(409).json({ error: 'sync_running', message: 'هناك مزامنة قيد التنفيذ حالياً' });
  }
  // المزامنة اليدوية تسحب التاريخ الكامل (أول تشغيل وعند الطلب)؛ الليلية أمس فقط
  // fire-and-forget; the frontend polls /stats for completion
  apify.syncReviews(branch, req.session.userId, { full: true })
    .catch((err) => console.error('reviews sync error:', err));
  res.status(202).json({ status: 'started', branch, message: 'بدأت المزامنة — قد تستغرق دقيقة إلى دقيقتين' });
});

module.exports = router;
