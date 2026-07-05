'use strict';
const express = require('express');
const { requireRole } = require('../auth');
const reports = require('../services/reports');
const { getSetting, setSetting, audit } = require('../db');

const router = express.Router();
router.use(requireRole('ops'));

// عدد طاولات الصالة — إعداد عام يضبطه مدير التشغيل، يُستخدم لمتوسط مبيعات الطاولة
router.get('/settings', (req, res) => {
  res.json({ tables_count: Number(getSetting('tables_count')) || null });
});

router.put('/settings', (req, res) => {
  const n = Number((req.body || {}).tables_count);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    return res.status(400).json({ error: 'bad_tables_count', message: 'عدد الطاولات يجب أن يكون رقماً صحيحاً' });
  }
  setSetting('tables_count', String(n));
  audit('tables_count_set', req.session.userId, { tables_count: n });
  res.json({ ok: true, tables_count: n });
});

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

// body: { notes: { customers: '...', operations: '...', kitchen: '...', maintenance: '...', general: '...' } }
router.put('/report/:date/notes', (req, res) => {
  const { date } = req.params;
  if (!reports.DATE_RE.test(date)) return res.status(400).json({ error: 'bad_date' });
  const notes = (req.body && req.body.notes) || {};
  if (typeof notes !== 'object' || Array.isArray(notes)) {
    return res.status(400).json({ error: 'bad_notes' });
  }
  const result = reports.upsertOpsNotes(date, req.session.userId, notes);
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
