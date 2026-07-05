'use strict';
const express = require('express');
const { requireRole } = require('../auth');
const reports = require('../services/reports');
const { db, BRANCHES } = require('../db');

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

function parseBranch(req) {
  const b = req.query.branch;
  return BRANCHES[b] ? b : 'all';
}

router.get('/branches', (req, res) => {
  res.json(Object.entries(BRANCHES).map(([key, name]) => ({ key, name })));
});

router.get('/reports', (req, res) => {
  const { from, to } = parseRange(req);
  const branch = parseBranch(req);
  res.json({ from, to, branch, reports: reports.listApproved(branch, from, to) });
});

router.get('/report/:date', (req, res) => {
  const { date } = req.params;
  const branch = parseBranch(req);
  if (!reports.DATE_RE.test(date)) return res.status(400).json({ error: 'bad_date' });
  const lookup = branch === 'all' ? 'jeddah' : branch;
  const report = reports.getReportByDate(lookup, date, { approvedOnly: true });
  if (!report) return res.status(404).json({ error: 'no_report', message: 'لا يوجد تقرير معتمد لهذا اليوم' });
  res.json(report);
});

router.get('/dashboard', (req, res) => {
  const { from, to } = parseRange(req);
  const branch = parseBranch(req);
  const data = reports.dashboardData(branch, from, to);

  const where = branch === 'all' ? '' : 'WHERE branch = ?';
  const args = branch === 'all' ? [] : [branch];
  const reviewStats = db.prepare(`
    SELECT COUNT(*) AS count, AVG(rating) AS avg_rating,
      SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative
    FROM reviews ${where}
  `).get(...args);
  const latestReviews = db.prepare(`
    SELECT author_name, rating, text, review_date, sentiment FROM reviews ${where}
    ORDER BY review_date DESC LIMIT 5
  `).all(...args);

  res.json({ from, to, branch, ...data, reviews: { ...reviewStats, latest: latestReviews } });
});

module.exports = router;
