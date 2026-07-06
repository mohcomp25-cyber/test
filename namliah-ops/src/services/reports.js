'use strict';
const { db, audit, BRANCHES, DEFAULT_BRANCH } = require('./../db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function riyadhToday() {
  // Business date in Asia/Riyadh (UTC+3, no DST)
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---- webhook ingest ----

function validatePayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return ['payload'];
  if (!DATE_RE.test(body.date || '')) errors.push('date');
  const s = body.summary;
  if (!s || typeof s !== 'object') {
    errors.push('summary');
  } else {
    if (typeof s.total_sales !== 'number' || !isFinite(s.total_sales)) errors.push('summary.total_sales');
    if (!Number.isInteger(s.orders_count) || s.orders_count < 0) errors.push('summary.orders_count');
    if (s.avg_ticket != null && typeof s.avg_ticket !== 'number') errors.push('summary.avg_ticket');
    if (s.payment_breakdown != null && typeof s.payment_breakdown !== 'object') errors.push('summary.payment_breakdown');
    if (s.channel_breakdown != null && typeof s.channel_breakdown !== 'object') errors.push('summary.channel_breakdown');
    if (s.external_sales != null && typeof s.external_sales !== 'object') errors.push('summary.external_sales');
    if (s.deductions != null && typeof s.deductions !== 'object') errors.push('summary.deductions');
    if (s.hourly_sales != null) {
      if (!Array.isArray(s.hourly_sales)) errors.push('summary.hourly_sales');
      else s.hourly_sales.forEach((h, i) => {
        if (!h || typeof h !== 'object' || !Number.isInteger(h.hour) || h.hour < 0 || h.hour > 23 ||
            typeof h.total !== 'number') {
          errors.push(`summary.hourly_sales[${i}]`);
        }
      });
    }
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (s.first_order_at != null && !TIME_RE.test(s.first_order_at)) errors.push('summary.first_order_at');
    if (s.last_order_at != null && !TIME_RE.test(s.last_order_at)) errors.push('summary.last_order_at');
    if (s.hall_sales != null) {
      if (!Array.isArray(s.hall_sales)) errors.push('summary.hall_sales');
      else s.hall_sales.forEach((w, i) => {
        if (!w || typeof w !== 'object' || !w.waiter || typeof w.total !== 'number') {
          errors.push(`summary.hall_sales[${i}]`);
        }
      });
    }
  }
  if (!Array.isArray(body.lines)) {
    errors.push('lines');
  } else {
    body.lines.forEach((l, i) => {
      if (!l || typeof l !== 'object' || !l.product_name ||
          typeof l.qty !== 'number' || typeof l.unit_price !== 'number' || typeof l.total !== 'number') {
        errors.push(`lines[${i}]`);
      }
    });
  }
  return errors;
}

// استخراج قيمة الاستلام فقط من أي شكل قديم/جديد (بما فيها delivery_apps المتداخلة تُهمل)
function extractTakeaway(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  const v = obj.takeaway;
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

const ingestTx = db.transaction((branch, body) => {
  const s = body.summary;
  const avgTicket = s.avg_ticket != null
    ? s.avg_ticket
    : (s.orders_count > 0 ? s.total_sales / s.orders_count : 0);
  // الطلبات الخارجية = استلام حصراً — لا بيع عبر تطبيقات التوصيل.
  // أي مفاتيح أخرى يرسلها الوورك فلو تُهمل ولا تدخل قاعدة البيانات.
  const externalSales = { takeaway: extractTakeaway(s.external_sales || s.channel_breakdown) };
  const deductions = s.deductions || {};
  const hallSales = Array.isArray(s.hall_sales) ? s.hall_sales : [];
  const hourly = Array.isArray(s.hourly_sales)
    ? [...s.hourly_sales].sort((a, b) => a.hour - b.hour)
    : [];
  const activeHours = hourly.filter((h) => (h.total || 0) > 0 || (h.orders || 0) > 0);
  const pad = (n) => String(n).padStart(2, '0');
  const firstOrderAt = s.first_order_at ||
    (activeHours.length ? `${pad(activeHours[0].hour)}:00` : null);
  const lastOrderAt = s.last_order_at ||
    (activeHours.length ? `${pad(activeHours[activeHours.length - 1].hour)}:00` : null);

  const existing = db.prepare('SELECT id, status FROM daily_reports WHERE branch = ? AND report_date = ?').get(branch, body.date);
  if (existing && existing.status === 'approved') {
    return { status: 'already_approved' };
  }

  let reportId;
  let action;
  if (existing) {
    db.prepare(`
      UPDATE daily_reports SET
        total_sales = ?, orders_count = ?, avg_ticket = ?,
        payment_breakdown = ?, channel_breakdown = ?, deductions = ?, hall_sales = ?,
        hourly_sales = ?, first_order_at = ?, last_order_at = ?,
        raw_payload = ?, received_at = datetime('now'), is_demo = 0
      WHERE id = ?
    `).run(
      s.total_sales, s.orders_count, avgTicket,
      JSON.stringify(s.payment_breakdown || {}), JSON.stringify(externalSales),
      JSON.stringify(deductions), JSON.stringify(hallSales),
      JSON.stringify(hourly), firstOrderAt, lastOrderAt,
      JSON.stringify(body), existing.id
    );
    if (s.deduction_notes && typeof s.deduction_notes === 'object') {
      db.prepare('UPDATE daily_reports SET deduction_notes = ? WHERE id = ?')
        .run(JSON.stringify(s.deduction_notes), existing.id);
    }
    db.prepare('DELETE FROM sales_lines WHERE report_id = ?').run(existing.id);
    reportId = existing.id;
    action = 'updated';
  } else {
    const info = db.prepare(`
      INSERT INTO daily_reports
        (branch, report_date, total_sales, orders_count, avg_ticket, payment_breakdown, channel_breakdown, deductions, deduction_notes, hall_sales, hourly_sales, first_order_at, last_order_at, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      branch, body.date, s.total_sales, s.orders_count, avgTicket,
      JSON.stringify(s.payment_breakdown || {}), JSON.stringify(externalSales),
      JSON.stringify(deductions),
      JSON.stringify((s.deduction_notes && typeof s.deduction_notes === 'object') ? s.deduction_notes : {}),
      JSON.stringify(hallSales),
      JSON.stringify(hourly), firstOrderAt, lastOrderAt,
      JSON.stringify(body)
    );
    reportId = info.lastInsertRowid;
    action = 'created';
  }

  const insLine = db.prepare(`
    INSERT INTO sales_lines (report_id, product_name, category, qty, unit_price, total)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const l of body.lines) {
    insLine.run(reportId, String(l.product_name), l.category ? String(l.category) : null, l.qty, l.unit_price, l.total);
  }
  return { status: action, reportId };
});

function ingestWebhook(branch, body) {
  const result = ingestTx(branch, body);
  if (result.status !== 'already_approved') {
    audit('webhook_received', null, { branch, date: body.date, action: result.status, lines: body.lines.length });
  }
  return result;
}

// ---- report reads ----

function reportRowToJson(row) {
  return {
    id: row.id,
    branch: row.branch,
    branch_name: BRANCHES[row.branch] || row.branch,
    report_date: row.report_date,
    status: row.status,
    total_sales: row.total_sales,
    orders_count: row.orders_count,
    avg_ticket: row.avg_ticket,
    payment_breakdown: JSON.parse(row.payment_breakdown || '{}'),
    external_sales: JSON.parse(row.channel_breakdown || '{}'),
    deductions: JSON.parse(row.deductions || '{}'),
    deduction_notes: JSON.parse(row.deduction_notes || '{}'),
    actual_payments: JSON.parse(row.actual_payments || '{}'),
    hall_sales: JSON.parse(row.hall_sales || '[]'),
    hourly_sales: JSON.parse(row.hourly_sales || '[]'),
    first_order_at: row.first_order_at || null,
    last_order_at: row.last_order_at || null,
    received_at: row.received_at,
    approved_at: row.approved_at,
    approved_by_name: row.approved_by_name || null,
    is_demo: !!row.is_demo
  };
}

function getReportByDate(branch, date, { approvedOnly = false } = {}) {
  const row = db.prepare(`
    SELECT r.*, u.display_name AS approved_by_name
    FROM daily_reports r LEFT JOIN users u ON u.id = r.approved_by
    WHERE r.branch = ? AND r.report_date = ? ${approvedOnly ? "AND r.status = 'approved'" : ''}
  `).get(branch, date);
  if (!row) return null;
  const report = reportRowToJson(row);
  report.lines = db.prepare(
    'SELECT product_name, category, qty, unit_price, total FROM sales_lines WHERE report_id = ? ORDER BY total DESC'
  ).all(row.id);
  report.notes = db.prepare(`
    SELECT n.id, n.category, n.body, n.created_at, n.updated_at, u.display_name AS author
    FROM notes n JOIN users u ON u.id = n.author_id
    WHERE n.report_id = ? ORDER BY n.created_at
  `).all(row.id);
  return report;
}

function latestReportDate(branch, maxDate) {
  const row = db.prepare(
    'SELECT report_date FROM daily_reports WHERE branch = ? AND report_date <= ? ORDER BY report_date DESC LIMIT 1'
  ).get(branch, maxDate);
  return row ? row.report_date : null;
}

function listDates(branch) {
  return db.prepare(
    'SELECT report_date, status FROM daily_reports WHERE branch = ? ORDER BY report_date DESC LIMIT 120'
  ).all(branch);
}

// ذروة المبيعات — من مصفوفة الساعات
function hourlyStats(hourly) {
  const rows = (Array.isArray(hourly) ? hourly : []).filter((h) => (h.total || 0) > 0);
  if (!rows.length) return { peak: null };
  const peak = rows.reduce((a, b) => (b.total > a.total ? b : a));
  return { peak: { hour: peak.hour, total: peak.total, orders: peak.orders || null } };
}

// ---- notes ----

const NOTE_CATEGORIES = ['customers', 'operations', 'kitchen', 'maintenance', 'general'];

// ملاحظة واحدة لكل تصنيف لكل تقرير — تُحدَّث في مكانها، وحذفها إن أُفرغ النص
const upsertNotesTx = db.transaction((reportId, userId, notesByCategory) => {
  for (const [category, rawBody] of Object.entries(notesByCategory)) {
    const body = String(rawBody || '').trim();
    const existing = db.prepare(
      'SELECT id FROM notes WHERE report_id = ? AND category = ?'
    ).get(reportId, category);
    if (!body) {
      if (existing) db.prepare('DELETE FROM notes WHERE id = ?').run(existing.id);
    } else if (existing) {
      db.prepare("UPDATE notes SET body = ?, author_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body, userId, existing.id);
    } else {
      db.prepare('INSERT INTO notes (report_id, author_id, category, body) VALUES (?, ?, ?, ?)')
        .run(reportId, userId, category, body);
    }
  }
});

function upsertOpsNotes(branch, date, userId, notesByCategory) {
  const report = db.prepare('SELECT id, status FROM daily_reports WHERE branch = ? AND report_date = ?').get(branch, date);
  if (!report) return { error: 'no_report' };
  if (report.status === 'approved') return { error: 'report_already_approved' };
  const filtered = {};
  for (const cat of NOTE_CATEGORIES) {
    if (cat in notesByCategory) filtered[cat] = notesByCategory[cat];
  }
  upsertNotesTx(report.id, userId, filtered);
  audit('notes_saved', userId, { branch, date, categories: Object.keys(filtered) });
  return { ok: true };
}

// ---- approval (= publication to management) ----

function approveReport(branch, date, userId) {
  const report = db.prepare('SELECT id, status FROM daily_reports WHERE branch = ? AND report_date = ?').get(branch, date);
  if (!report) return { error: 'no_report' };
  if (report.status === 'approved') return { error: 'report_already_approved' };
  db.prepare(`
    UPDATE daily_reports SET status = 'approved', approved_at = datetime('now'), approved_by = ?
    WHERE id = ?
  `).run(userId, report.id);
  audit('report_approved', userId, { branch, date });
  return { ok: true };
}

// ---- deduction notes (ملاحظات مدير التشغيل مقابل بنود الخصم) ----

const DEDUCTION_KEYS = ['coupons', 'discounts', 'cancellations'];

function saveDeductionNotes(branch, date, userId, notesObj) {
  const report = db.prepare(
    'SELECT id, status, deduction_notes FROM daily_reports WHERE branch = ? AND report_date = ?'
  ).get(branch, date);
  if (!report) return { error: 'no_report' };
  if (report.status === 'approved') return { error: 'report_already_approved' };
  const current = JSON.parse(report.deduction_notes || '{}');
  for (const key of DEDUCTION_KEYS) {
    if (key in notesObj) {
      const val = String(notesObj[key] || '').trim();
      if (val) current[key] = val; else delete current[key];
    }
  }
  db.prepare('UPDATE daily_reports SET deduction_notes = ? WHERE id = ?')
    .run(JSON.stringify(current), report.id);
  audit('deduction_notes_saved', userId, { branch, date });
  return { ok: true };
}

// ---- طرق الدفع الفعلية (جرد مدير التشغيل لإظهار الفروقات) ----

function saveActualPayments(branch, date, userId, obj) {
  const report = db.prepare(
    'SELECT id, status, actual_payments FROM daily_reports WHERE branch = ? AND report_date = ?'
  ).get(branch, date);
  if (!report) return { error: 'no_report' };
  if (report.status === 'approved') return { error: 'report_already_approved' };
  const current = JSON.parse(report.actual_payments || '{}');
  for (const [key, raw] of Object.entries(obj || {})) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(key)) continue;
    const val = raw === '' || raw == null ? null : Number(raw);
    if (val == null || !isFinite(val)) delete current[key];
    else current[key] = val;
  }
  db.prepare('UPDATE daily_reports SET actual_payments = ? WHERE id = ?')
    .run(JSON.stringify(current), report.id);
  audit('actual_payments_saved', userId, { branch, date });
  return { ok: true };
}

// ---- admin aggregates ----

function branchFilterSql(branch) {
  return branch && branch !== 'all' ? 'AND r.branch = ?' : '';
}
function branchFilterArgs(branch) {
  return branch && branch !== 'all' ? [branch] : [];
}

function listApproved(branch, from, to) {
  return db.prepare(`
    SELECT r.branch, r.report_date, r.status, r.total_sales, r.orders_count, r.avg_ticket, r.approved_at,
           (SELECT substr(n.body, 1, 120) FROM notes n WHERE n.report_id = r.id ORDER BY n.created_at LIMIT 1) AS note_preview
    FROM daily_reports r
    WHERE r.status = 'approved' AND r.report_date BETWEEN ? AND ? ${branchFilterSql(branch)}
    ORDER BY r.report_date DESC
  `).all(from, to, ...branchFilterArgs(branch));
}

function dashboardData(branch, from, to) {
  const reports = db.prepare(`
    SELECT * FROM daily_reports r
    WHERE r.status = 'approved' AND r.report_date BETWEEN ? AND ? ${branchFilterSql(branch)}
    ORDER BY r.report_date
  `).all(from, to, ...branchFilterArgs(branch));

  const trendByDate = new Map();
  for (const r of reports) {
    const t = trendByDate.get(r.report_date) || { date: r.report_date, total_sales: 0, orders_count: 0 };
    t.total_sales += r.total_sales;
    t.orders_count += r.orders_count;
    trendByDate.set(r.report_date, t);
  }
  const trend = [...trendByDate.values()].map((t) => ({
    ...t,
    avg_ticket: t.orders_count > 0 ? t.total_sales / t.orders_count : 0
  }));

  const totals = {
    total_sales: reports.reduce((a, r) => a + r.total_sales, 0),
    orders_count: reports.reduce((a, r) => a + r.orders_count, 0),
    days: reports.length
  };
  totals.avg_ticket = totals.orders_count > 0 ? totals.total_sales / totals.orders_count : 0;
  totals.avg_daily_sales = totals.days > 0 ? totals.total_sales / totals.days : 0;

  // Merge JSON breakdowns in JS (tiny row counts; simpler than SQLite JSON1)
  const paymentMix = {};
  const externalMix = {};
  const deductionsMix = {};
  const waiterTotals = {};
  const addFlat = (target, obj, prefix) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === 'object') addFlat(target, v, k);
      else if (typeof v === 'number') {
        const key = prefix ? `${prefix}:${k}` : k;
        target[key] = (target[key] || 0) + v;
      }
    }
  };
  for (const r of reports) {
    addFlat(paymentMix, JSON.parse(r.payment_breakdown || '{}'), '');
    addFlat(externalMix, JSON.parse(r.channel_breakdown || '{}'), '');
    addFlat(deductionsMix, JSON.parse(r.deductions || '{}'), '');
    for (const w of JSON.parse(r.hall_sales || '[]')) {
      if (w && w.waiter && typeof w.total === 'number') {
        waiterTotals[w.waiter] = (waiterTotals[w.waiter] || 0) + w.total;
      }
    }
  }
  const hourlyTotals = {};
  for (const r of reports) {
    for (const h of JSON.parse(r.hourly_sales || '[]')) {
      if (h && Number.isInteger(h.hour) && typeof h.total === 'number') {
        hourlyTotals[h.hour] = (hourlyTotals[h.hour] || 0) + h.total;
      }
    }
  }
  const dayCount = Math.max(1, reports.length);
  const hourlyMix = Object.entries(hourlyTotals)
    .map(([hour, total]) => ({ hour: Number(hour), avg_total: total / dayCount }))
    .sort((a, b) => a.hour - b.hour);

  const waiters = Object.entries(waiterTotals)
    .map(([waiter, total]) => ({ waiter, total }))
    .sort((a, b) => b.total - a.total);

  const ids = reports.map((r) => r.id);
  let topProducts = [];
  let categoryMix = [];
  let notesFeed = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    topProducts = db.prepare(`
      SELECT product_name, SUM(qty) AS qty, SUM(total) AS total
      FROM sales_lines WHERE report_id IN (${ph})
      GROUP BY product_name ORDER BY total DESC LIMIT 10
    `).all(...ids);
    categoryMix = db.prepare(`
      SELECT COALESCE(category, 'أخرى') AS category, SUM(total) AS total
      FROM sales_lines WHERE report_id IN (${ph})
      GROUP BY category ORDER BY total DESC
    `).all(...ids);
    notesFeed = db.prepare(`
      SELECT r.report_date, r.branch, n.category, n.body, u.display_name AS author, n.updated_at
      FROM notes n
      JOIN daily_reports r ON r.id = n.report_id
      JOIN users u ON u.id = n.author_id
      WHERE n.report_id IN (${ph})
      ORDER BY r.report_date DESC LIMIT 40
    `).all(...ids);
  }

  return { totals, trend, paymentMix, externalMix, deductionsMix, waiters, hourlyMix, topProducts, categoryMix, notesFeed };
}

module.exports = {
  DATE_RE,
  NOTE_CATEGORIES,
  DEDUCTION_KEYS,
  saveDeductionNotes,
  saveActualPayments,
  hourlyStats,
  riyadhToday,
  validatePayload,
  ingestWebhook,
  getReportByDate,
  latestReportDate,
  listDates,
  upsertOpsNotes,
  approveReport,
  listApproved,
  dashboardData
};
