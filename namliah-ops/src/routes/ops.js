'use strict';
const express = require('express');
const { requireRole } = require('../auth');
const reports = require('../services/reports');

const router = express.Router();
router.use(requireRole('ops'));

router.get('/report', (req, res) => {
  let date = req.query.date;
  if (date && !reports.DATE_RE.test(date)) {
    return res.status(400).json({ error: 'bad_date', message: 'صيغة التاريخ غير صحيحة' });
  }
  if (!date) {
    date = reports.latestReportDate(reports.riyadhToday());
    if (!date) return res.status(404).json({ error: 'no_report', message: 'لم تصل بيانات مبيعات بعد' });
  }
  const report = reports.getReportByDate(date);
  if (!report) return res.status(404).json({ error: 'no_report', message: 'لا يوجد تقرير لهذا اليوم' });
  res.json(report);
});

router.get('/dates', (req, res) => {
  res.json(reports.listDates());
});

router.put('/report/:date/notes', (req, res) => {
  const { date } = req.params;
  const body = String((req.body && req.body.body) || '').trim();
  if (!reports.DATE_RE.test(date)) return res.status(400).json({ error: 'bad_date' });
  if (!body) return res.status(400).json({ error: 'empty_note', message: 'الملاحظة فارغة' });
  const result = reports.upsertOpsNote(date, req.session.userId, body);
  if (result.error === 'no_report') return res.status(404).json({ error: 'no_report' });
  if (result.error === 'report_already_approved') {
    return res.status(409).json({ error: 'report_already_approved', message: 'التقرير معتمد ولا يمكن تعديله' });
  }
  res.json({ ok: true });
});

router.post('/report/:date/approve', (req, res) => {
  const { date } = req.params;
  if (!reports.DATE_RE.test(date)) return res.status(400).json({ error: 'bad_date' });
  const result = reports.approveReport(date, req.session.userId);
  if (result.error === 'no_report') return res.status(404).json({ error: 'no_report' });
  if (result.error === 'report_already_approved') {
    return res.status(409).json({ error: 'report_already_approved', message: 'التقرير معتمد مسبقاً' });
  }
  res.json({ ok: true, message: 'تم اعتماد التقرير ونشره للإدارة' });
});

module.exports = router;
