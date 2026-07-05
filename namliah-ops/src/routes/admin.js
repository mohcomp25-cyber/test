'use strict';
const express = require('express');
const { requireRole } = require('../auth');
const reports = require('../services/reports');
const { db } = require('../db');

const router = express.Router();
router.use(requireRole('admin'));

function parseRange(req) {
  const today = reports.riyadhToday();
  const to = reports.DATE_RE.test(req.query.to || '') ? req.query.to : today;
  const defaultFrom = new Date(new Date(to + 'T00:00:00Z').getTime() - 29 * 86400000)
    .toISOString().slice(0, 10);
  const from = reports.DATE_RE.test(req.query.from || '') ? req.query.from : defaultFrom;
  return { from, to };
}

router.get('/reports', (req, res) => {
  const { from, to } = parseRange(req);
  res.json({ from, to, reports: reports.listApproved(from, to) });
});

router.get('/report/:date', (req, res) => {
  const { date } = req.params;
  if (!reports.DATE_RE.test(date)) return res.status(400).json({ error: 'bad_date' });
  const report = reports.getReportByDate(date, { approvedOnly: true });
  if (!report) return res.status(404).json({ error: 'no_report', message: 'لا يوجد تقرير معتمد لهذا اليوم' });
  res.json(report);
});

router.get('/dashboard', (req, res) => {
  const { from, to } = parseRange(req);
  const data = reports.dashboardData(from, to);

  const reviewStats = db.prepare(`
    SELECT COUNT(*) AS count, AVG(rating) AS avg_rating,
      SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative
    FROM reviews
  `).get();
  const latestReviews = db.prepare(
    'SELECT author_name, rating, text, review_date, sentiment FROM reviews ORDER BY review_date DESC LIMIT 5'
  ).all();

  res.json({ from, to, ...data, reviews: { ...reviewStats, latest: latestReviews } });
});

module.exports = router;
