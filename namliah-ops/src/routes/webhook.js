'use strict';
const crypto = require('crypto');
const express = require('express');
const { BRANCHES, DEFAULT_BRANCH } = require('../db');
const { validatePayload, ingestWebhook } = require('../services/reports');

const router = express.Router();

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

module.exports = router;
