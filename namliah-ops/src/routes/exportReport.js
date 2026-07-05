'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const reports = require('../services/reports');
const { db } = require('../db');

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
  dine_in: 'صالة', takeaway: 'استلام', delivery: 'توصيل', delivery_apps: 'تطبيقات التوصيل',
  hungerstation: 'هنقرستيشن', jahez: 'جاهز', toyou: 'تويو', mrsool: 'مرسول', keeta: 'كيتا'
};
const label = (k) => LABELS[k.split(':').pop()] || k.split(':').pop();

function flatMix(obj, prefix) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object') Object.assign(out, flatMix(v, k));
    else if (typeof v === 'number') out[prefix ? `${prefix}:${k}` : k] = v;
  }
  return out;
}

function mixRows(mix) {
  const entries = Object.entries(flatMix(mix)).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="muted">لا توجد بيانات</p>';
  const sum = entries.reduce((a, [, v]) => a + v, 0) || 1;
  return entries.map(([k, v]) =>
    `<div class="mix-row"><span>${esc(label(k))}</span><b>${money(v)}</b><span class="muted">${fmt.format((v / sum) * 100)}٪</span></div>`
  ).join('');
}

const STAR = '★';
const stars = (r) => `<span class="stars">${STAR.repeat(r)}<span class="stars-off">${STAR.repeat(5 - r)}</span></span>`;

router.get('/:date/print', requireAuth, (req, res) => {
  const { date } = req.params;
  if (!reports.DATE_RE.test(date)) return res.status(400).send('تاريخ غير صحيح');
  const approvedOnly = req.session.role === 'admin';
  const report = reports.getReportByDate(date, { approvedOnly });
  if (!report) return res.status(404).send('لا يوجد تقرير لهذا اليوم');

  const latestReviews = db.prepare(`
    SELECT author_name, rating, text, review_date, sentiment FROM reviews
    ORDER BY review_date DESC LIMIT 4
  `).all();
  const reviewStats = db.prepare('SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews').get();

  const linesRows = report.lines.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(l.product_name)}</td>
      <td>${esc(l.category || '—')}</td>
      <td class="num">${fmt.format(l.qty)}</td>
      <td class="num">${money(l.unit_price)}</td>
      <td class="num">${money(l.total)}</td>
    </tr>`).join('');

  const notesHtml = report.notes.length
    ? report.notes.map((n) => `
        <div class="note">
          <div class="note-head"><b>${esc(n.author)}</b><span class="muted">${esc(n.updated_at)}</span></div>
          <p>${esc(n.body).replace(/\n/g, '<br>')}</p>
        </div>`).join('')
    : '<p class="muted">لا توجد ملاحظات تشغيلية لهذا اليوم</p>';

  const reviewsHtml = latestReviews.length
    ? latestReviews.map((r) => `
        <div class="review">
          <div class="note-head"><b>${esc(r.author_name || 'زائر')}</b>${stars(r.rating)}<span class="muted">${esc(r.review_date || '')}</span></div>
          ${r.text ? `<p>${esc(r.text)}</p>` : ''}
        </div>`).join('')
    : '<p class="muted">لا توجد مراجعات محفوظة بعد</p>';

  const approvalStamp = report.status === 'approved'
    ? `<div class="stamp approved">✔ تقرير معتمد<small>اعتُمد بواسطة ${esc(report.approved_by_name || '—')} — ${esc(report.approved_at || '')}</small></div>`
    : '<div class="stamp pending">تقرير غير معتمد بعد</div>';

  res.send(`<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>التقرير اليومي — نملية — ${esc(date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Amiri:wght@700&display=swap" rel="stylesheet">
<style>
  :root{--olive:#1F2A1A;--olive2:#3B4A2A;--gold:#C9A24B;--beige:#F5EFE3;--cream:#FBF8F1;--ink:#2B2B23;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Cairo',sans-serif;color:var(--ink);background:var(--beige);padding:24px;font-size:14px}
  .sheet{max-width:800px;margin:0 auto;background:var(--cream);border:1px solid #E3D9C2;border-radius:12px;overflow:hidden}
  header{background:linear-gradient(135deg,var(--olive),var(--olive2));color:var(--beige);padding:28px 32px;display:flex;justify-content:space-between;align-items:center;gap:16px}
  header .brand{font-family:'Amiri',serif;font-size:34px;color:var(--gold)}
  header .sub{opacity:.85;font-size:13px}
  header .date{font-size:20px;font-weight:700}
  .gold-line{height:3px;background:linear-gradient(90deg,var(--gold),#E3C77E,var(--gold))}
  main{padding:28px 32px}
  h2{font-size:16px;color:var(--olive2);border-inline-start:4px solid var(--gold);padding-inline-start:10px;margin:26px 0 12px}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .kpi{background:#fff;border:1px solid #EAE2CE;border-radius:10px;padding:14px 16px}
  .kpi .lbl{font-size:12px;color:#6B6B58}
  .kpi .val{font-size:22px;font-weight:700;color:var(--olive)}
  .mixes{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  .mix-row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px dashed #E3D9C2}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden}
  th{background:var(--olive2);color:var(--beige);padding:8px 10px;font-size:12px;text-align:right}
  td{padding:7px 10px;border-bottom:1px solid #F0EADA}
  tr:nth-child(even) td{background:#FAF6EC}
  .num{font-variant-numeric:tabular-nums;text-align:left;direction:ltr}
  .note,.review{background:#fff;border:1px solid #EAE2CE;border-radius:10px;padding:12px 14px;margin-bottom:10px}
  .note-head{display:flex;gap:10px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
  .muted{color:#8A8A72;font-size:12px}
  .stars{color:var(--gold);letter-spacing:2px}
  .stars-off{color:#DDD4BC}
  .stamp{margin-top:26px;border:2px solid;border-radius:12px;padding:14px 18px;display:inline-flex;flex-direction:column;gap:4px;font-weight:700}
  .stamp.approved{border-color:#4E7A3A;color:#4E7A3A;transform:rotate(-1.5deg)}
  .stamp.pending{border-color:#A94438;color:#A94438}
  .stamp small{font-weight:400;font-size:12px}
  footer{padding:16px 32px;color:#8A8A72;font-size:12px;display:flex;justify-content:space-between;border-top:1px solid #EAE2CE}
  .print-btn{position:fixed;bottom:24px;inset-inline-start:24px;background:var(--gold);color:var(--olive);border:0;border-radius:999px;padding:14px 26px;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}
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
      <div class="brand">نملية</div>
      <div class="sub">التقرير التشغيلي اليومي — فرع جدة</div>
    </div>
    <div class="date">${esc(date)}</div>
  </header>
  <div class="gold-line"></div>
  <main>
    <div class="kpis">
      <div class="kpi"><div class="lbl">إجمالي المبيعات</div><div class="val">${money(report.total_sales)}</div></div>
      <div class="kpi"><div class="lbl">عدد الطلبات</div><div class="val">${fmt.format(report.orders_count)}</div></div>
      <div class="kpi"><div class="lbl">متوسط الفاتورة</div><div class="val">${money(report.avg_ticket)}</div></div>
    </div>

    <h2>مزيج المبيعات</h2>
    <div class="mixes">
      <div><h3 class="muted">طرق الدفع</h3>${mixRows(report.payment_breakdown)}</div>
      <div><h3 class="muted">قنوات البيع</h3>${mixRows(report.channel_breakdown)}</div>
    </div>

    <h2>تفاصيل المبيعات (${fmt.format(report.lines.length)} صنف)</h2>
    <table>
      <thead><tr><th>#</th><th>الصنف</th><th>التصنيف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${linesRows || '<tr><td colspan="6" class="muted">لا توجد تفاصيل</td></tr>'}</tbody>
    </table>

    <h2>الملاحظات التشغيلية</h2>
    ${notesHtml}

    <h2>مراجعات قوقل ماب${reviewStats.count ? ` — المتوسط ${fmt.format(reviewStats.avg)} من ٥ (${fmt.format(reviewStats.count)} مراجعة)` : ''}</h2>
    ${reviewsHtml}

    ${approvalStamp}
  </main>
  <footer>
    <span>منصة عمليات نملية</span>
    <span>أُنشئ في ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC</span>
  </footer>
</div>
<button class="print-btn" onclick="window.print()">🖨 طباعة / حفظ PDF</button>
</body>
</html>`);
});

module.exports = router;
