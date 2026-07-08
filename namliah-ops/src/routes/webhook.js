'use strict';
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { BRANCHES, DEFAULT_BRANCH } = require('../db');
const { validatePayload, ingestWebhook } = require('../services/reports');
const { parseCsv, transformByBranch } = require('../services/foodics');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// مفتاح سري لكل فرع: WEBHOOK_SECRET_JEDDAH / _ABHA / _MAKKAH
// (WEBHOOK_SECRET القديم يُعامل كمفتاح جدة للتوافق)
function branchSecrets() {
  const map = {};
  for (const branch of Object.keys(BRANCHES)) {
    const secret = process.env[`WEBHOOK_SECRET_${branch.toUpperCase()}`];
    if (secret) map[branch] = secret;
  }
  if (!map[DEFAULT_BRANCH] && process.env.WEBHOOK_SECRET) {
    map[DEFAULT_BRANCH] = process.env.WEBHOOK_SECRET;
  }
  return map;
}

function matchBranch(provided) {
  const a = Buffer.from(String(provided || ''));
  let matched = null;
  for (const [branch, secret] of Object.entries(branchSecrets())) {
    const b = Buffer.from(secret);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) matched = branch;
  }
  return matched;
}

router.post('/sales', (req, res) => {
  const branch = matchBranch(req.get('X-Webhook-Secret'));
  if (!branch) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const errors = validatePayload(req.body);
  if (errors.length) {
    return res.status(400).json({ error: 'validation', fields: errors });
  }
  const result = ingestWebhook(branch, req.body);
  if (result.status === 'already_approved') {
    return res.status(409).json({ error: 'report_already_approved', branch, report_date: req.body.date });
  }
  res.json({ status: result.status, branch, report_date: req.body.date });
});

// ---- رفع ملفات فودكس الخام مباشرة (multipart) — المنصة تحوّل وتقسّم الفروع ----
// يُصادَق بمفتاح رفع رئيسي واحد (FOODICS_UPLOAD_SECRET) يخوّل كل الفروع.
function uploadSecretOk(provided) {
  const expected = process.env.FOODICS_UPLOAD_SECRET || '';
  if (!expected) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const foodicsFields = upload.fields([
  { name: 'orders', maxCount: 1 },
  { name: 'items', maxCount: 1 },
  { name: 'payments', maxCount: 1 }
]);

router.post('/foodics', foodicsFields, (req, res) => {
  if (!uploadSecretOk(req.get('X-Webhook-Secret'))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  // الملفات إما مرفقة (multipart) أو نصوص في الجسم (JSON)
  const pick = (name) => {
    const f = req.files && req.files[name] && req.files[name][0];
    if (f) return f.buffer.toString('utf8');
    if (req.body && typeof req.body[name] === 'string') return req.body[name];
    return null;
  };
  const ordersCsv = pick('orders');
  const itemsCsv = pick('items');
  const paymentsCsv = pick('payments');
  if (!ordersCsv || !itemsCsv || !paymentsCsv) {
    return res.status(400).json({ error: 'missing_files', message: 'مطلوب الملفات الثلاثة: orders, items, payments' });
  }

  let groups;
  try {
    groups = transformByBranch(
      parseCsv(ordersCsv), parseCsv(itemsCsv), parseCsv(paymentsCsv),
      (req.body && req.body.date) || null
    );
  } catch (err) {
    return res.status(400).json({ error: 'parse_failed', message: err.message });
  }

  const results = [];
  for (const g of groups) {
    if (!g.key) { results.push({ branch: g.name, status: 'skipped_unknown_branch' }); continue; }
    if (!g.payload || g.payload.summary.orders_count === 0) {
      results.push({ branch: g.key, status: 'skipped_no_orders' });
      continue;
    }
    const r = ingestWebhook(g.key, g.payload);
    results.push({
      branch: g.key,
      report_date: g.payload.date,
      total_sales: g.payload.summary.total_sales,
      orders_count: g.payload.summary.orders_count,
      status: r.status === 'already_approved' ? 'report_already_approved' : r.status
    });
  }
  res.json({ ok: true, branches: results });
});

module.exports = router;
