'use strict';
const { db, audit } = require('./../db');

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

const ingestTx = db.transaction((body) => {
  const s = body.summary;
  const avgTicket = s.avg_ticket != null
    ? s.avg_ticket
    : (s.orders_count > 0 ? s.total_sales / s.orders_count : 0);
  // external_sales هو الاسم الجديد للطلبات الخارجية؛ channel_breakdown مقبول للتوافق
  const externalSales = s.external_sales || s.channel_breakdown || {};
  const deductions = s.deductions || {};
  const hallSales = Array.isArray(s.hall_sales) ? s.hall_sales : [];

  const existing = db.prepare('SELECT id, status FROM daily_reports WHERE report_date = ?').get(body.date);
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
        raw_payload = ?, received_at = datetime('now'), is_demo = 0
      WHERE id = ?
    `).run(
      s.total_sales, s.orders_count, avgTicket,
      JSON.stringify(s.payment_breakdown || {}), JSON.stringify(externalSales),
      JSON.stringify(deductions), JSON.stringify(hallSales),
      JSON.stringify(body), existing.id
    );
    db.prepare('DELETE FROM sales_lines WHERE report_id = ?').run(existing.id);
    reportId = existing.id;
    action = 'updated';
  } else {
    const info = db.prepare(`
      INSERT INTO daily_reports
        (report_date, total_sales, orders_count, avg_ticket, payment_breakdown, channel_breakdown, deductions, hall_sales, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.date, s.total_sales, s.orders_count, avgTicket,
      JSON.stringify(s.payment_breakdown || {}), JSON.stringify(externalSales),
      JSON.stringify(deductions), JSON.stringify(hallSales),
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

function ingestWebhook(body) {
  const result = ingestTx(body);
  if (result.status !== 'already_approved') {
    audit('webhook_received', null, { date: body.date, action: result.status, lines: body.lines.length });
  }
  return result;
}

// ---- report reads ----

function reportRowToJson(row) {
  return {
    id: row.id,
    report_date: row.report_date,
    status: row.status,
    total_sales: row.total_sales,
    orders_count: row.orders_count,
    avg_ticket: row.avg_ticket,
    payment_breakdown: JSON.parse(row.payment_breakdown || '{}'),
    external_sales: JSON.parse(row.channel_breakdown || '{}'),
    deductions: JSON.parse(row.deductions || '{}'),
    hall_sales: JSON.parse(row.hall_sales || '[]'),
    received_at: row.received_at,
    approved_at: row.approved_at,
    approved_by_name: row.approved_by_name || null,
    is_demo: !!row.is_demo
  };
}

function getReportByDate(date, { approvedOnly = false } = {}) {
  const row = db.prepare(`
    SELECT r.*, u.display_name AS approved_by_name
    FROM daily_reports r LEFT JOIN users u ON u.id = r.approved_by
    WHERE r.report_date = ? ${approvedOnly ? "AND r.status = 'approved'" : ''}
  `).get(date);
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

function latestReportDate(maxDate) {
  const row = db.prepare(
    'SELECT report_date FROM daily_reports WHERE report_date <= ? ORDER BY report_date DESC LIMIT 1'
  ).get(maxDate);
  return row ? row.report_date : null;
}

function listDates() {
  return db.prepare(
    'SELECT report_date, status FROM daily_reports ORDER BY report_date DESC LIMIT 120'
  ).all();
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

function upsertOpsNotes(date, userId, notesByCategory) {
  const report = db.prepare('SELECT id, status FROM daily_reports WHERE report_date = ?').get(date);
  if (!report) return { error: 'no_report' };
  if (report.status === 'approved') return { error: 'report_already_approved' };
  const filtered = {};
  for (const cat of NOTE_CATEGORIES) {
    if (cat in notesByCategory) filtered[cat] = notesByCategory[cat];
  }
  upsertNotesTx(report.id, userId, filtered);
  audit('notes_saved', userId, { date, categories: Object.keys(filtered) });
  return { ok: true };
}

// ---- approval (= publication to management) ----

function approveReport(date, userId) {
  const report = db.prepare('SELECT id, status FROM daily_reports WHERE report_date = ?').get(date);
  if (!report) return { error: 'no_report' };
  if (report.status === 'approved') return { error: 'report_already_approved' };
  db.prepare(`
    UPDATE daily_reports SET status = 'approved', approved_at = datetime('now'), approved_by = ?
    WHERE id = ?
  `).run(userId, report.id);
  audit('report_approved', userId, { date });
  return { ok: true };
}

// ---- admin aggregates ----

function listApproved(from, to) {
  return db.prepare(`
    SELECT r.report_date, r.status, r.total_sales, r.orders_count, r.avg_ticket, r.approved_at,
           (SELECT substr(n.body, 1, 120) FROM notes n WHERE n.report_id = r.id ORDER BY n.created_at LIMIT 1) AS note_preview
    FROM daily_reports r
    WHERE r.status = 'approved' AND r.report_date BETWEEN ? AND ?
    ORDER BY r.report_date DESC
  `).all(from, to);
}

function dashboardData(from, to) {
  const reports = db.prepare(`
    SELECT * FROM daily_reports
    WHERE status = 'approved' AND report_date BETWEEN ? AND ?
    ORDER BY report_date
  `).all(from, to);

  const trend = reports.map((r) => ({
    date: r.report_date,
    total_sales: r.total_sales,
    orders_count: r.orders_count,
    avg_ticket: r.avg_ticket
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
      SELECT r.report_date, n.category, n.body, u.display_name AS author, n.updated_at
      FROM notes n
      JOIN daily_reports r ON r.id = n.report_id
      JOIN users u ON u.id = n.author_id
      WHERE n.report_id IN (${ph})
      ORDER BY r.report_date DESC LIMIT 40
    `).all(...ids);
  }

  return { totals, trend, paymentMix, externalMix, deductionsMix, waiters, topProducts, categoryMix, notesFeed };
}

module.exports = {
  DATE_RE,
  NOTE_CATEGORIES,
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
