'use strict';
// منطق صفحة مدير التشغيل

let currentDate = null;
let currentStatus = null;
let isAdminViewer = false;

async function loadDates() {
  const dates = await api('/api/ops/dates');
  const select = document.getElementById('dateSelect');
  select.innerHTML = dates.map((d) =>
    `<option value="${d.report_date}">${d.report_date} ${d.status === 'approved' ? '✔' : '•'}</option>`
  ).join('');
  return dates;
}

function setLocked(locked) {
  document.getElementById('noteBody').disabled = locked;
  document.getElementById('saveNoteBtn').disabled = locked;
  const approveBtn = document.getElementById('approveBtn');
  approveBtn.disabled = locked;
  approveBtn.textContent = locked ? '✔ التقرير معتمد ومنشور للإدارة' : '✔ اعتماد التقرير ونشره للإدارة';
}

async function loadReport(date) {
  let report;
  try {
    report = await api(`/api/ops/report${date ? `?date=${date}` : ''}`);
  } catch (err) {
    if (err.status === 404) {
      document.getElementById('reportArea').style.display = 'none';
      document.getElementById('emptyState').style.display = 'block';
      return;
    }
    throw err;
  }
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('reportArea').style.display = 'flex';

  currentDate = report.report_date;
  currentStatus = report.status;
  document.getElementById('dateSelect').value = report.report_date;

  const badge = document.getElementById('statusBadge');
  badge.className = `badge badge--${report.status}`;
  badge.textContent = report.status === 'approved' ? '✔ معتمد ومنشور' : '⏳ بانتظار الاعتماد';
  document.getElementById('receivedAt').textContent =
    `آخر استلام من الوورك فلو: ${report.received_at}${report.is_demo ? ' (بيانات تجريبية)' : ''}`;

  document.getElementById('kpiSales').textContent = money(report.total_sales);
  document.getElementById('kpiOrders').textContent = nf0.format(report.orders_count);
  document.getElementById('kpiAvg').textContent = money(report.avg_ticket);

  renderMixList(document.getElementById('paymentMix'), report.payment_breakdown);
  renderMixList(document.getElementById('channelMix'), report.channel_breakdown);

  document.getElementById('linesCount').textContent = `${nf0.format(report.lines.length)} صنف`;
  document.getElementById('linesBody').innerHTML = report.lines.map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(l.product_name)}</td>
      <td>${esc(l.category || '—')}</td>
      <td class="num">${nf.format(l.qty)}</td>
      <td class="num">${money(l.unit_price)}</td>
      <td class="num">${money(l.total)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">لا توجد تفاصيل</td></tr>';

  const opsNote = report.notes.length ? report.notes[report.notes.length - 1] : null;
  document.getElementById('noteBody').value = opsNote ? opsNote.body : '';

  document.getElementById('exportBtn').href = `/report/${report.report_date}/print`;
  setLocked(report.status === 'approved' || isAdminViewer);
}

async function loadReviews() {
  const [stats, list] = await Promise.all([
    api('/api/reviews/stats'),
    api('/api/reviews?page=1')
  ]);
  const kpi = document.getElementById('kpiRating');
  const sub = document.getElementById('kpiRatingSub');
  if (stats.count > 0) {
    kpi.innerHTML = `${nf.format(stats.avg_rating)} <small>من ٥ (${nf0.format(stats.count)} مراجعة)</small>`;
    sub.innerHTML = `<span class="up">▲ ${nf0.format(stats.positive)} إيجابي</span> · <span class="down">▼ ${nf0.format(stats.negative)} سلبي</span>`;
  } else {
    kpi.innerHTML = '<small>لا توجد مراجعات بعد</small>';
  }
  document.getElementById('reviewsMeta').textContent = stats.configured
    ? (stats.last_sync_at ? `آخر مزامنة: ${stats.last_sync_at.slice(0, 16).replace('T', ' ')}` : 'لم تتم مزامنة بعد')
    : 'المزامنة غير مُفعّلة (أضف APIFY_TOKEN)';
  document.getElementById('reviewsStrip').innerHTML =
    list.reviews.slice(0, 3).map(reviewCardHtml).join('') ||
    '<p class="muted">لا توجد مراجعات محفوظة — جرّب المزامنة.</p>';
  return stats;
}

async function pollSync() {
  const btn = document.getElementById('syncReviewsBtn');
  btn.disabled = true;
  btn.textContent = '⏳ جارٍ المزامنة…';
  const timer = setInterval(async () => {
    const stats = await loadReviews();
    if (!stats.sync_running) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = '↻ مزامنة الآن';
      toast(stats.last_sync_status === 'ok' ? 'تمت مزامنة المراجعات بنجاح' : `المزامنة: ${stats.last_sync_status || 'انتهت'}`,
        stats.last_sync_status !== 'ok');
    }
  }, 8000);
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initTopbar();
  isAdminViewer = user.role === 'admin';

  const dates = await loadDates();
  await loadReport(dates.length ? null : undefined);
  loadReviews().catch(() => {});

  document.getElementById('dateSelect').addEventListener('change', (e) => loadReport(e.target.value));

  document.getElementById('saveNoteBtn').addEventListener('click', async () => {
    const body = document.getElementById('noteBody').value.trim();
    if (!body) return toast('اكتب ملاحظة أولاً', true);
    try {
      await api(`/api/ops/report/${currentDate}/notes`, { method: 'PUT', body: { body } });
      toast('تم حفظ الملاحظات');
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('approveBtn').addEventListener('click', async () => {
    if (currentStatus === 'approved') return;
    const noteBody = document.getElementById('noteBody').value.trim();
    if (!confirm(`اعتماد تقرير يوم ${currentDate} ونشره للإدارة؟\nلا يمكن التعديل عليه بعد الاعتماد.`)) return;
    try {
      if (noteBody) {
        await api(`/api/ops/report/${currentDate}/notes`, { method: 'PUT', body: { body: noteBody } }).catch(() => {});
      }
      const res = await api(`/api/ops/report/${currentDate}/approve`, { method: 'POST' });
      toast(res.message || 'تم الاعتماد');
      await loadDates();
      await loadReport(currentDate);
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('syncReviewsBtn').addEventListener('click', async () => {
    try {
      await api('/api/reviews/sync', { method: 'POST' });
      toast('بدأت المزامنة — قد تستغرق دقيقة إلى دقيقتين');
      pollSync();
    } catch (err) { toast(err.message, true); }
  });
});
