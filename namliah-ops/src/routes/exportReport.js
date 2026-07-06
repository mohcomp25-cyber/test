'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const reports = require('../services/reports');
const { db, getSetting, BRANCHES, DEFAULT_BRANCH } = require('../db');

const router = express.Router();

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const money = (n) => `${fmt.format(n || 0)} ر.س`;

const LABELS = {
  cash: 'نقدي', card: 'شبكة/بطاقة', online: 'دفع إلكتروني', other: 'أخرى',
  dine_in: 'صالة', hall: 'صالة', takeaway: 'استلام', qlub: 'قلب (دفع QR)',
  coupons: 'كوبونات', discounts: 'خصومات', cancellations: 'إلغاءات'
};
const label = (k) => LABELS[k.split(':').pop()] || k.split(':').pop();

const NOTE_LABELS = {
  customers: 'ملاحظات الزبائن وحلولها',
  operations: 'ملاحظات تشغيلية',
  kitchen: 'ملاحظات المطبخ',
  maintenance: 'ملاحظات الصيانة',
  general: 'ملاحظات عامة'
};

function flatMix(obj, prefix) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object') Object.assign(out, flatMix(v, k));
    else if (typeof v === 'number') out[prefix ? `${prefix}:${k}` : k] = v;
  }
  return out;
}

function mixRows(mix, { withTotal = false, totalLabel = 'الإجمالي' } = {}) {
  const entries = Object.entries(flatMix(mix)).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="muted">لا توجد بيانات</p>';
  const sum = entries.reduce((a, [, v]) => a + v, 0) || 1;
  const rows = entries.map(([k, v]) =>
    `<div class="mix-row"><span>${esc(label(k))}</span><b>${money(v)}</b><span class="muted pct">${fmt.format((v / sum) * 100)}٪</span></div>`
  ).join('');
  const total = withTotal
    ? `<div class="mix-row mix-total-row"><span>${totalLabel}</span><b>${money(sum)}</b><span class="pct"></span></div>` : '';
  return rows + total;
}

const STAR = '★';
const stars = (r) => `<span class="stars">${STAR.repeat(r)}<span class="stars-off">${STAR.repeat(5 - r)}</span></span>`;

function linesTable(title, rows, headColor) {
  const body = rows.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(l.product_name)}</td>
      <td class="num">${fmt.format(l.qty)}</td>
      <td class="num">${money(l.total)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">—</td></tr>';
  return `
    <table>
      <thead>
        <tr><th colspan="4" style="text-align:center;background:${headColor}">${title}</th></tr>
        <tr><th>#</th><th>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

router.get('/:date/print', requireAuth, (req, res) => {
  const { date } = req.params;
  if (!reports.DATE_RE.test(date)) return res.status(400).send('تاريخ غير صحيح');
  // مدير التشغيل يطبع تقرير فرعه؛ الإدارة تحدد ?branch=
  const branch = req.session.role === 'ops'
    ? (req.session.branch || DEFAULT_BRANCH)
    : (BRANCHES[req.query.branch] ? req.query.branch : DEFAULT_BRANCH);
  const approvedOnly = req.session.role === 'admin';
  const report = reports.getReportByDate(branch, date, { approvedOnly });
  if (!report) return res.status(404).send('لا يوجد تقرير لهذا اليوم');

  // مراجعات يوم العمل نفسه (تاريخ التقرير)
  const latestReviews = db.prepare(`
    SELECT author_name, rating, text, review_date, sentiment, photos FROM reviews
    WHERE branch = ? AND review_date = ? ORDER BY id DESC
  `).all(branch, date);
  const reviewStats = db.prepare('SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE branch = ?').get(branch);

  // مبيعات الصالة حسب الويتر
  const hall = [...(report.hall_sales || [])].sort((a, b) => b.total - a.total);
  const hallTotal = hall.reduce((a, w) => a + (w.total || 0), 0);
  const waitersRows = hall.map((w) => `
    <tr><td>${esc(w.waiter)}</td><td class="num">${money(w.total)}</td>
    <td class="num">${hallTotal ? fmt.format((w.total / hallTotal) * 100) : 0}%</td></tr>`).join('');

  const tablesCount = Number(getSetting(`tables_count:${branch}`)) || null;
  const tableAvg = tablesCount && hallTotal > 0 ? hallTotal / tablesCount : null;

  const d = report.deductions || {};
  const dn = report.deduction_notes || {};
  const deductionsLine = [
    ['كوبونات', d.coupons, dn.coupons], ['خصومات', d.discounts, dn.discounts], ['إلغاءات', d.cancellations, dn.cancellations]
  ].map(([l, v, note]) =>
    `${l}: <b>${money(v || 0)}</b>${note ? ` <span class="ded-note">(${esc(note)})</span>` : ''}`
  ).join(' · ');

  // المبيعات بالساعة: الذروة + أعمدة CSS مصغّرة
  const hourly = (report.hourly_sales || []).filter((h) => (h.total || 0) > 0);
  const { peak } = reports.hourlyStats(hourly);
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  const timingLine = peak
    ? `وقت الذروة: <b>${hh(peak.hour)}</b> (${money(peak.total)}) · أول طلب: <b>${esc(report.first_order_at || hh(hourly[0].hour))}</b> · آخر طلب: <b>${esc(report.last_order_at || hh(hourly[hourly.length - 1].hour))}</b>`
    : null;
  const maxHour = peak ? peak.total : 1;
  const hourlyBars = hourly.length ? `
    <div class="hours">
      ${hourly.map((h) => `
        <div class="hour-col" title="${hh(h.hour)} — ${money(h.total)}">
          <span class="hour-val">${h.total >= 1000 ? `${fmt.format(h.total / 1000)}k` : fmt.format(Math.round(h.total))}</span>
          <span class="hour-bar" style="height:${Math.max(4, Math.round((h.total / maxHour) * 70))}px"></span>
          <span class="hour-lbl">${hh(h.hour)}</span>
        </div>`).join('')}
    </div>` : '';

  // طرق الدفع الفعلية (جرد مدير التشغيل) مع الفروقات
  const actualPayments = report.actual_payments || {};
  const systemPayments = flatMix(report.payment_breakdown);
  const actualKeys = Object.keys(systemPayments).filter((k) => actualPayments[k] != null);
  const actualPaymentsHtml = actualKeys.length ? `
    <h3 class="muted" style="margin:12px 0 4px">الجرد الفعلي والفروقات</h3>
    ${actualKeys.map((k) => {
      const sys = systemPayments[k] || 0;
      const act = actualPayments[k];
      const diff = +(act - sys).toFixed(2);
      const cls = diff === 0 ? 'diff-ok' : diff < 0 ? 'diff-minus' : 'diff-plus';
      const label_ = diff === 0 ? 'مطابق' : `${diff > 0 ? '+' : ''}${fmt.format(diff)} ر.س`;
      return `<div class="mix-row"><span>${esc(label(k))} (فعلي)</span><b>${money(act)}</b><span class="pct ${cls}">${label_}</span></div>`;
    }).join('')}` : '';

  const lines = report.lines || [];
  const topLines = lines.slice(0, 10);
  const bottomLines = lines.length > 10 ? lines.slice(-10).reverse() : [];

  const notesByCat = {};
  (report.notes || []).forEach((n) => { notesByCat[n.category] = n; });
  const notesHtml = Object.entries(NOTE_LABELS)
    .filter(([cat]) => notesByCat[cat])
    .map(([cat, catLabel]) => `
      <div class="note">
        <div class="note-head"><b>${catLabel}</b><span class="muted">${esc(notesByCat[cat].updated_at)}</span></div>
        <p>${esc(notesByCat[cat].body).replace(/\n/g, '<br>')}</p>
      </div>`).join('') || '<p class="muted">لا توجد ملاحظات لهذا اليوم</p>';

  const reviewsHtml = latestReviews.length
    ? latestReviews.map((r) => {
        const photos = (() => { try { return JSON.parse(r.photos || '[]'); } catch { return []; } })();
        const imgs = photos.slice(0, 4).map((p) =>
          `<img src="${esc(p)}" style="width:64px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--line-soft)">`).join('');
        return `
        <div class="review">
          <div class="note-head"><b>${esc(r.author_name || 'زائر')}</b>${stars(r.rating)}<span class="muted">${esc(r.review_date || '')}</span></div>
          ${r.text ? `<p>${esc(r.text)}</p>` : ''}
          ${imgs ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px">${imgs}</div>` : ''}
        </div>`;
      }).join('')
    : '<p class="muted">لا توجد مراجعات بتاريخ يوم العمل</p>';

  const approvalStamp = report.status === 'approved'
    ? `<div class="stamp approved">تقرير معتمد<small>اعتُمد بواسطة ${esc(report.approved_by_name || '—')} · ${esc(report.approved_at || '')}</small></div>`
    : '<div class="stamp pending">تقرير غير معتمد بعد</div>';

  res.send(`<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>التقرير اليومي — نملية — ${esc(date)}</title>
<link rel="stylesheet" href="/css/fonts.css">
<style>
  :root{
    --ink:#1a1410;--ink-soft:#3a2f25;--bottle:#1F3A2E;--bottle-deep:#14271F;
    --parchment:#F1E6CF;--paper:#FBF6EB;--bone:#F6EEDD;--parch2:#E8D9BB;
    --brass:#B89253;--brass-deep:#8C6A35;--brass-light:#D7B47A;
    --success:#4F7A4C;--error:#9A3A1E;--terracotta:#B5612C;
    --line:rgba(26,20,16,.14);--line-soft:rgba(26,20,16,.07);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Tajawal',sans-serif;color:var(--ink);background:var(--parchment);padding:24px;font-size:13.5px;line-height:1.8}
  .sheet{max-width:820px;margin:0 auto;background:var(--paper);border:1px solid var(--line-soft);border-radius:14px;overflow:hidden}
  header{background:linear-gradient(160deg,var(--bottle-deep),var(--bottle));color:var(--parchment);padding:26px 32px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
  header img{height:64px;display:block}
  header .sub{opacity:.85;font-size:12.5px}
  header .date{font-family:'Amiri',serif;font-size:26px;font-weight:700;color:var(--brass-light)}
  .brass-line{height:2px;background:linear-gradient(90deg,var(--brass),var(--brass-light),var(--brass))}
  main{padding:26px 32px}
  h2{font-family:'Amiri',serif;font-size:19px;color:var(--bottle);margin:24px 0 10px;display:flex;align-items:center;gap:10px}
  h2::before{content:'';width:24px;height:2px;background:var(--brass);flex:none}
  h2 small{font-family:'Tajawal',sans-serif;font-size:11.5px;color:var(--ink-soft);font-weight:400}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .kpi{background:#fff;border:1px solid var(--line-soft);border-radius:10px;padding:10px 14px}
  .kpi .lbl{font-size:11.5px;color:var(--ink-soft)}
  .kpi .val{font-size:19px;font-weight:800;color:var(--bottle);font-variant-numeric:tabular-nums}
  .deductions{background:var(--bone);border:1px dashed var(--brass);border-radius:10px;padding:7px 14px;margin-top:10px;font-size:12.5px;color:var(--ink-soft)}
  .deductions b{color:var(--ink);font-variant-numeric:tabular-nums}
  .ded-note{color:var(--brass-deep);font-size:11.5px}
  .diff-ok{color:var(--success);font-weight:700}
  .diff-minus{color:var(--error);font-weight:700}
  .diff-plus{color:#C57A1F;font-weight:700}
  .hours{display:flex;align-items:flex-end;gap:6px;background:#fff;border:1px solid var(--line-soft);border-radius:10px;padding:12px 14px 8px;overflow-x:auto}
  .hour-col{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:34px;flex:1}
  .hour-val{font-size:9.5px;color:var(--ink-soft);font-variant-numeric:tabular-nums}
  .hour-bar{width:100%;max-width:26px;background:linear-gradient(180deg,#6B7A3B,#5F7A26);border-radius:4px 4px 0 0}
  .hour-lbl{font-size:9.5px;color:var(--ink-soft);direction:ltr}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .mix-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed var(--line-soft)}
  .mix-row .pct{min-width:44px;text-align:left;direction:ltr}
  .mix-total-row{border-bottom:0;border-top:1.5px solid var(--brass);font-weight:800;color:var(--bottle)}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:12.5px}
  th{background:var(--bottle);color:var(--parchment);padding:6px 10px;font-size:11.5px;text-align:right}
  td{padding:5px 10px;border-bottom:1px solid var(--line-soft)}
  tr:nth-child(even) td{background:var(--bone)}
  tfoot td{background:var(--parch2);font-weight:800;color:var(--bottle);border-top:1px solid var(--brass)}
  .num{font-variant-numeric:tabular-nums;text-align:left;direction:ltr}
  .note,.review{background:#fff;border:1px solid var(--line-soft);border-radius:10px;padding:10px 14px;margin-bottom:8px}
  .note-head{display:flex;gap:10px;align-items:center;margin-bottom:4px;flex-wrap:wrap}
  .note-head b{color:var(--bottle)}
  .muted{color:var(--ink-soft);opacity:.75;font-size:11.5px}
  .stars{color:var(--brass-deep);letter-spacing:2px}
  .stars-off{color:var(--parch2)}
  .stamp{margin-top:24px;border:2px solid;border-radius:12px;padding:12px 18px;display:inline-flex;flex-direction:column;gap:2px;font-weight:800;font-family:'Amiri',serif;font-size:17px}
  .stamp.approved{border-color:var(--success);color:var(--success);transform:rotate(-1.5deg)}
  .stamp.pending{border-color:var(--error);color:var(--error)}
  .stamp small{font-family:'Tajawal',sans-serif;font-weight:400;font-size:11.5px}
  footer{padding:14px 32px;color:var(--ink-soft);font-size:11.5px;display:flex;justify-content:space-between;border-top:1px solid var(--line-soft);flex-wrap:wrap;gap:6px}
  .print-btn{position:fixed;bottom:22px;inset-inline-start:22px;background:linear-gradient(180deg,var(--brass),var(--brass-deep));color:var(--paper);border:0;border-radius:999px;padding:13px 26px;font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(26,20,16,.3)}
  @media (max-width:640px){.cols{grid-template-columns:1fr}header{padding:18px 20px}main{padding:18px 20px}}
  @media print{
    body{background:#fff;padding:0}
    .sheet{border:0;border-radius:0;max-width:none}
    .print-btn{display:none}
  }
  @page{size:A4;margin:12mm}
</style>
</head>
<body>
<div class="sheet">
  <header>
    <div>
      <img src="/img/logo-cream.png" alt="نملية — مطعم من الريف اللبناني">
      <div class="sub">التقرير التشغيلي اليومي · فرع ${esc(report.branch_name)}</div>
    </div>
    <div class="date">${esc(date)}</div>
  </header>
  <div class="brass-line"></div>
  <main>
    <div class="kpis">
      <div class="kpi"><div class="lbl">إجمالي المبيعات</div><div class="val">${money(report.total_sales)}</div></div>
      <div class="kpi"><div class="lbl">عدد الطلبات</div><div class="val">${fmt.format(report.orders_count)}</div></div>
      <div class="kpi"><div class="lbl">متوسط الفاتورة</div><div class="val">${money(report.avg_ticket)}</div></div>
      <div class="kpi"><div class="lbl">متوسط مبيعات الطاولة</div><div class="val">${tableAvg ? money(tableAvg) : '—'}</div></div>
    </div>
    <div class="deductions">${deductionsLine}${tablesCount ? ` · عدد الطاولات: <b>${fmt.format(tablesCount)}</b>` : ''}</div>
    ${timingLine ? `<div class="deductions" style="margin-top:6px">${timingLine}</div>` : ''}

    ${hourlyBars ? `<h2>المبيعات بالساعة</h2>${hourlyBars}` : ''}

    <h2>توزيع المبيعات</h2>
    <div class="cols">
      <div>
        <table>
          <thead><tr><th colspan="3" style="text-align:center">مبيعات الصالة حسب الويتر</th></tr>
          <tr><th>الويتر</th><th>المبيعات</th><th>النسبة</th></tr></thead>
          <tbody>${waitersRows || '<tr><td colspan="3" class="muted">لا توجد بيانات</td></tr>'}</tbody>
          ${hallTotal ? `<tfoot><tr><td>إجمالي الصالة</td><td class="num">${money(hallTotal)}</td><td class="num">100%</td></tr></tfoot>` : ''}
        </table>
      </div>
      <div>
        <h3 class="muted" style="margin-bottom:4px">الطلبات الخارجية</h3>
        <div class="mix-row"><span>استلام</span><b>${money((report.external_sales || {}).takeaway || 0)}</b><span class="pct"></span></div>
        <h3 class="muted" style="margin:12px 0 4px">طرق الدفع</h3>
        ${mixRows(report.payment_breakdown)}
        ${actualPaymentsHtml}
      </div>
    </div>

    <h2>تفاصيل المبيعات <small>${fmt.format(lines.length)} صنف إجمالاً</small></h2>
    <div class="cols">
      <div>${linesTable('الأكثر مبيعاً — ١٠ أصناف', topLines, 'var(--bottle-deep)')}</div>
      <div>${linesTable('الأقل مبيعاً — ١٠ أصناف', bottomLines, 'var(--terracotta)')}</div>
    </div>

    <h2>الملاحظات اليومية</h2>
    ${notesHtml}

    <h2>مراجعات قوقل ماب — يوم ${esc(date)} <small>(${fmt.format(latestReviews.length)})${reviewStats.count ? ` · المتوسط العام ${fmt.format(reviewStats.avg)} من ٥` : ''}</small></h2>
    ${reviewsHtml}

    ${approvalStamp}
  </main>
  <footer>
    <span>نملية · مطعم من الريف اللبناني — منصة العمليات</span>
    <span>أُنشئ في ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC</span>
  </footer>
</div>
<button class="print-btn" onclick="window.print()">طباعة / حفظ PDF</button>
</body>
</html>`);
});

module.exports = router;
