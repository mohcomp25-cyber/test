'use strict';
const express = require('express');
const { requireRole } = require('../auth');
const reports = require('../services/reports');
const { getSetting, setSetting, audit, BRANCHES, DEFAULT_BRANCH } = require('../db');

const router = express.Router();
router.use(requireRole('ops'));

// فرع الطلب: فرع مدير التشغيل من الجلسة، أو ?branch= عندما تتصفح الإدارة للقراءة
function reqBranch(req) {
  if (req.session.role === 'ops') return req.session.branch || DEFAULT_BRANCH;
  const b = req.query.branch;
  return BRANCHES[b] ? b : DEFAULT_BRANCH;
}

// عدد طاولات الصالة — إعداد لكل فرع، يُستخدم لمتوسط مبيعات الطاولة
router.get('/settings', (req, res) => {
  const branch = reqBranch(req);
  res.json({ branch, tables_count: Number(getSetting(`tables_count:${branch}`)) || null });
});

router.put('/settings', (req, res) => {
  const branch = reqBranch(req);
  const n = Number((req.body || {}).tables_count);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    return res.status(400).json({ error: 'bad_tables_count', message: 'عدد الطاولات يجب أن يكون رقماً صحيحاً' });
  }
  setSetting(`tables_count:${branch}`, String(n));
  audit('tables_count_set', req.session.userId, { branch, tables_count: n });
  res.json({ ok: true, tables_count: n });
});

router.get('/report', (req, res) => {
  const branch = reqBranch(req);
  let date = req.query.date;
  if (date && !reports.DATE_RE.test(date)) {
    return res.status(400).json({ error: 'bad_date', message: 'صيغة التاريخ غير صحيحة' });
  }
  if (!date) {
    date = reports.latestReportDate(branch, reports.riyadhToday());
    if (!date) return res.status(404).json({ error: 'no_report', message: 'لم تصل بيانات مبيعات بعد' });
  }
  const report = reports.getReportByDate(branch, date);
  if (!report) return res.status(404).json({ error: 'no_report', message: 'لا يوجد تقرير لهذا اليوم' });
  res.json(report);
});

router.get('/dates', (req, res) => {
  res.json(reports.listDates(reqBranch(req)));
});

// body: { notes: {customers,...}, deduction_notes: {coupons,...}, actual_payments: {cash, card, online} }
router.put('/report/:date/notes', (req, res) => {
  const branch = reqBranch(req);
  const { date } = req.params;
  if (!reports.DATE_RE.test(date)) return res.status(400).json({ error: 'bad_date' });
  const notes = (req.body && req.body.notes) || {};
  const deductionNotes = (req.body && req.body.deduction_notes) || null;
  const actualPayments = (req.body && req.body.actual_payments) || null;
  if (typeof notes !== 'object' || Array.isArray(notes)) {
    return res.status(400).json({ error: 'bad_notes' });
  }
  const result = reports.upsertOpsNotes(branch, date, req.session.userId, notes);
  if (result.error === 'no_report') return res.status(404).json({ error: 'no_report' });
  if (result.error === 'report_already_approved') {
    return res.status(409).json({ error: 'report_already_approved', message: 'التقرير معتمد ولا يمكن تعديله' });
  }
  if (deductionNotes && typeof deductionNotes === 'object' && !Array.isArray(deductionNotes)) {
    reports.saveDeductionNotes(branch, date, req.session.userId, deductionNotes);
  }
  if (actualPayments && typeof actualPayments === 'object' && !Array.isArray(actualPayments)) {
    reports.saveActualPayments(branch, date, req.session.userId, actualPayments);
  }
  res.json({ ok: true });
});

router.post('/report/:date/approve', (req, res) => {
  const branch = reqBranch(req);
  const { date } = req.params;
  if (!reports.DATE_RE.test(date)) return res.status(400).json({ error: 'bad_date' });
  const result = reports.approveReport(branch, date, req.session.userId);
  if (result.error === 'no_report') return res.status(404).json({ error: 'no_report' });
  if (result.error === 'report_already_approved') {
    return res.status(409).json({ error: 'report_already_approved', message: 'التقرير معتمد مسبقاً' });
  }
  res.json({ ok: true, message: 'تم اعتماد التقرير ونشره للإدارة' });
});

module.exports = router;
