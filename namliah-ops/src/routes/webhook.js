'use strict';
const crypto = require('crypto');
const express = require('express');
const { validatePayload, ingestWebhook } = require('../services/reports');

const router = express.Router();

function secretMatches(provided) {
  const expected = process.env.WEBHOOK_SECRET || '';
  if (!expected) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/sales', (req, res) => {
  if (!secretMatches(req.get('X-Webhook-Secret'))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const errors = validatePayload(req.body);
  if (errors.length) {
    return res.status(400).json({ error: 'validation', fields: errors });
  }
  const result = ingestWebhook(req.body);
  if (result.status === 'already_approved') {
    return res.status(409).json({ error: 'report_already_approved', report_date: req.body.date });
  }
  res.json({ status: result.status, report_date: req.body.date });
});

module.exports = router;
