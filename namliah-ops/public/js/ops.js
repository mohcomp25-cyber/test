'use strict';
// منطق صفحة مدير التشغيل

const NOTE_CATS = ['customers', 'operations', 'kitchen', 'maintenance', 'general'];

let currentDate = null;
let currentStatus = null;
let isAdminViewer = false;
let tablesCount = null;
let currentHallTotal = 0;

async function loadDates() {
  const dates = await api('/api/ops/dates');
  const select = document.getElementById('dateSelect');
  select.innerHTML = dates.map((d) =>
    `<option value="${d.report_date}">${d.report_date} ${d.status === 'approved' ? '✓' : '•'}</option>`
  ).join('');
  return dates;
}

async function loadTables() {
  const s = await api('/api/ops/settings');
  tablesCount = s.tables_count;
  if (tablesCount) document.getElementById('tablesCount').value = tablesCount;
}

const DED_KEYS = ['coupons', 'discounts', 'cancellations'];

function setLocked(locked) {
  NOTE_CATS.forEach((c) => { document.getElementById(`note-${c}`).disabled = locked; });
  DED_KEYS.forEach((k) => { document.getElementById(`dedNote-${k}`).disabled = locked; });
  document.querySelectorAll('.actual-input').forEach((el) => { el.disabled = locked; });
  document.getElementById('saveNoteBtn').disabled = locked;
  const approveBtn = document.getElementById('approveBtn');
  approveBtn.disabled = locked;
  approveBtn.textContent = locked ? 'التقرير معتمد ومنشور للإدارة' : 'اعتماد التقرير ونشره للإدارة';
}

function renderTableAvg() {
  const el = document.getElementById('kpiTableAvg');
  const sub = document.getElementById('kpiTableSub');
  if (tablesCount && currentHallTotal > 0) {
    el.textContent = money(currentHallTotal / tablesCount);
    sub.textContent = `مبيعات الصالة ÷ ${nf0.format(tablesCount)} طاولة`;
  } else {
    el.innerHTML = '<small>حدد عدد الطاولات أعلاه</small>';
    sub.textContent = '';
  }
}

function renderWaiters(hallSales) {
  const body = document.getElementById('waitersBody');
  const foot = document.getElementById('waitersFoot');
  const total = hallSales.reduce((a, w) => a + (w.total || 0), 0);
  currentHallTotal = total;
  if (!hallSales.length) {
    body.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:18px">لم تصل بيانات الويترز بعد من الوورك فلو</td></tr>';
    foot.innerHTML = '';
    return;
  }
  const sorted = [...hallSales].sort((a, b) => b.total - a.total);
  body.innerHTML = sorted.map((w) => `
    <tr>
      <td>${esc(w.waiter)}</td>
      <td class="num">${money(w.total)}</td>
      <td class="num">${total ? nf.format((w.total / total) * 100) : 0}%</td>
    </tr>`).join('');
  foot.innerHTML = `<tr><td>إجمالي الصالة</td><td class="num">${money(total)}</td><td class="num">100%</td></tr>`;
}

// بطاقة الاستلام: الطلبات الخارجية = استلام حصراً (لا بيع عبر تطبيقات التوصيل)
function renderExternal(mix, reportTotal) {
  const pickup = (mix && typeof mix.takeaway === 'number') ? mix.takeaway : 0;
  document.getElementById('pickupTotal').textContent = money(pickup);
  document.getElementById('pickupShare').textContent = reportTotal && pickup
    ? `${nf.format((pickup / reportTotal) * 100)}٪ من إجمالي المبيعات` : '';
}

// طرق الدفع الفعلية: جرد مدير التشغيل مقابل أرقام النظام — الفروقات تظهر مباشرة
let systemPayments = {};

function diffHtml(system, actualRaw) {
  if (actualRaw === '' || actualRaw == null) return '<span class="pm-diff pm-diff--empty">—</span>';
  const actual = Number(actualRaw);
  if (!isFinite(actual)) return '<span class="pm-diff pm-diff--empty">—</span>';
  const diff = +(actual - system).toFixed(2);
  if (diff === 0) return '<span class="pm-diff pm-diff--zero">مطابق</span>';
  const cls = diff < 0 ? 'pm-diff--minus' : 'pm-diff--plus';
  const sign = diff > 0 ? '+' : '';
  return `<span class="pm-diff ${cls}">${sign}${nf.format(diff)} ر.س</span>`;
}

function updateActualTotals() {
  const totalEl = document.getElementById('actualTotal');
  let sysSum = 0;
  let actSum = 0;
  let anyFilled = false;
  document.querySelectorAll('.actual-row').forEach((row) => {
    const key = row.dataset.key;
    const input = row.querySelector('input');
    row.querySelector('.pm-diff-cell').innerHTML = diffHtml(systemPayments[key] || 0, input.value);
    // الإجماليات تقارن الطرق المعبأة فقط حتى لا تُحسب طريقة غير مجرودة كفرق
    if (input.value !== '' && isFinite(Number(input.value))) {
      sysSum += systemPayments[key] || 0;
      actSum += Number(input.value);
      anyFilled = true;
    }
  });
  if (!anyFilled) { totalEl.innerHTML = ''; return; }
  const diff = +(actSum - sysSum).toFixed(2);
  const cls = diff === 0 ? 'pm-diff--zero' : diff < 0 ? 'pm-diff--minus' : 'pm-diff--plus';
  const sign = diff > 0 ? '+' : '';
  totalEl.innerHTML = `
    <span>إجمالي الفعلي: <span class="num">${money(actSum)}</span></span>
    <span>إجمالي الفرق: <span class="pm-diff ${cls}">${diff === 0 ? 'مطابق' : `${sign}${nf.format(diff)} ر.س`}</span></span>`;
}

function renderActualPayments(report) {
  systemPayments = flattenMix(report.payment_breakdown || {});
  const actual = report.actual_payments || {};
  const keys = Object.keys(systemPayments);
  const container = document.getElementById('actualRows');
  if (!keys.length) {
    container.innerHTML = '<p class="muted">لا توجد طرق دفع واردة من الوورك فلو بعد.</p>';
    document.getElementById('actualTotal').innerHTML = '';
    return;
  }
  container.innerHTML = keys.map((k, i) => `
    <div class="actual-row" data-key="${esc(k)}">
      <span class="pm-name"><span class="dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>${esc(mixLabel(k))}</span>
      <span class="pm-system">النظام: <b>${money(systemPayments[k])}</b></span>
      <input class="input actual-input" type="number" step="0.01" min="0" inputmode="decimal"
        placeholder="المبلغ الفعلي" value="${actual[k] != null ? actual[k] : ''}">
      <span class="pm-diff-cell"></span>
    </div>`).join('');
  container.querySelectorAll('.actual-input').forEach((input) => {
    input.addEventListener('input', updateActualTotals);
  });
  updateActualTotals();
}

function collectActualPayments() {
  const out = {};
  document.querySelectorAll('.actual-row').forEach((row) => {
    out[row.dataset.key] = row.querySelector('input').value;
  });
  return out;
}

// المبيعات بالساعة: بطاقات الذروة/أول/آخر طلب + رسم أعمدة
let hourlyChart = null;
function renderHourly(report) {
  const hourly = (report.hourly_sales || []).filter((h) => (h.total || 0) > 0);
  const box = document.getElementById('hourlyBox');
  const empty = document.getElementById('hourlyEmpty');

  if (!hourly.length) {
    box.style.display = 'none';
    empty.style.display = 'block';
    document.getElementById('kpiPeak').textContent = '—';
    document.getElementById('kpiPeakSub').textContent = '';
    document.getElementById('kpiFirstOrder').textContent = report.first_order_at || '—';
    document.getElementById('kpiLastOrder').textContent = report.last_order_at || '—';
    if (hourlyChart) { hourlyChart.destroy(); hourlyChart = null; }
    return;
  }
  box.style.display = '';
  empty.style.display = 'none';

  const peak = hourly.reduce((a, b) => (b.total > a.total ? b : a));
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  document.getElementById('kpiPeak').textContent = hh(peak.hour);
  document.getElementById('kpiPeakSub').textContent =
    `${money(peak.total)}${peak.orders ? ` · ${nf0.format(peak.orders)} طلب` : ''}`;
  document.getElementById('kpiFirstOrder').textContent = report.first_order_at || hh(hourly[0].hour);
  document.getElementById('kpiLastOrder').textContent = report.last_order_at || hh(hourly[hourly.length - 1].hour);

  if (hourlyChart) hourlyChart.destroy();
  hourlyChart = new Chart(document.getElementById('hourlyChart'), {
    type: 'bar',
    data: {
      labels: hourly.map((h) => hh(h.hour)),
      datasets: [{
        label: 'المبيعات',
        data: hourly.map((h) => h.total),
        backgroundColor: CHART_COLORS[0],
        maxBarThickness: 24
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => ` ${money(c.parsed.y)}${hourly[c.dataIndex].orders ? ` · ${nf0.format(hourly[c.dataIndex].orders)} طلب` : ''}`
          }
        }
      },
      scales: {
        x: { reverse: true, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => (v >= 1000 ? `${nf.format(v / 1000)}k` : nf0.format(v)) } }
      }
    }
  });
}

function linesRow(l, i) {
  return `<tr><td>${i + 1}</td><td>${esc(l.product_name)}</td><td class="num">${nf.format(l.qty)}</td><td class="num">${money(l.total)}</td></tr>`;
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
  badge.textContent = report.status === 'approved' ? 'معتمد ومنشور' : 'بانتظار الاعتماد';
  document.getElementById('receivedAt').textContent =
    `آخر استلام: ${report.received_at}${report.is_demo ? ' (بيانات تجريبية)' : ''}`;

  // المؤشرات
  document.getElementById('kpiSales').textContent = money(report.total_sales);
  const d = report.deductions || {};
  const dn = report.deduction_notes || {};
  document.getElementById('dedCoupons').textContent = money(d.coupons || 0);
  document.getElementById('dedDiscounts').textContent = money(d.discounts || 0);
  document.getElementById('dedCancellations').textContent = money(d.cancellations || 0);
  DED_KEYS.forEach((k) => { document.getElementById(`dedNote-${k}`).value = dn[k] || ''; });
  document.getElementById('kpiOrders').textContent = nf0.format(report.orders_count);
  document.getElementById('kpiAvg').textContent = money(report.avg_ticket);

  // طرق الدفع المصغّرة + توزيع المبيعات
  renderChips(document.getElementById('paymentChips'), report.payment_breakdown);
  renderActualPayments(report);
  renderHourly(report);
  renderWaiters(report.hall_sales || []);
  renderExternal(report.external_sales || {}, report.total_sales);
  renderTableAvg();

  // الأكثر والأقل مبيعاً (السطور تصل مرتبة تنازلياً بالإجمالي)
  const lines = report.lines || [];
  document.getElementById('linesCount').textContent = `${nf0.format(lines.length)} صنف إجمالاً`;
  document.getElementById('topLinesBody').innerHTML =
    lines.slice(0, 10).map(linesRow).join('') ||
    '<tr><td colspan="4" class="muted" style="text-align:center;padding:14px">لا توجد تفاصيل</td></tr>';
  const bottom = lines.length > 10 ? lines.slice(-10).reverse() : [];
  document.getElementById('bottomLinesBody').innerHTML =
    bottom.map(linesRow).join('') ||
    '<tr><td colspan="4" class="muted" style="text-align:center;padding:14px">—</td></tr>';

  // الملاحظات المصنفة
  const byCat = {};
  (report.notes || []).forEach((n) => { byCat[n.category] = n.body; });
  NOTE_CATS.forEach((c) => { document.getElementById(`note-${c}`).value = byCat[c] || ''; });

  document.getElementById('exportBtn').href = `/report/${report.report_date}/print`;
  setLocked(report.status === 'approved' || isAdminViewer);

  // مراجعات قوقل ليوم هذا التقرير
  loadReviews().catch(() => {});
}

function collectNotes() {
  const notes = {};
  NOTE_CATS.forEach((c) => { notes[c] = document.getElementById(`note-${c}`).value; });
  return notes;
}

function collectDeductionNotes() {
  const out = {};
  DED_KEYS.forEach((k) => { out[k] = document.getElementById(`dedNote-${k}`).value; });
  return out;
}

async function loadReviews() {
  // مراجعات يوم العمل (تاريخ التقرير الحالي) — كلها، مع الصور
  const dayParam = currentDate ? `&date=${currentDate}` : '';
  const [stats, list] = await Promise.all([
    api('/api/reviews/stats'),
    api(`/api/reviews?page=1${dayParam}`)
  ]);
  const kpi = document.getElementById('kpiRating');
  const sub = document.getElementById('kpiRatingSub');
  if (stats.count > 0) {
    kpi.innerHTML = `${nf.format(stats.avg_rating)} <small>من ٥ (${nf0.format(stats.count)} إجمالاً)</small>`;
    sub.innerHTML = `<span class="up">${nf0.format(stats.positive)} إيجابي</span> · <span class="down">${nf0.format(stats.negative)} سلبي</span>`;
  } else {
    kpi.innerHTML = '<small>لا توجد مراجعات بعد</small>';
  }
  const syncInfo = stats.configured
    ? (stats.last_sync_at ? `آخر مزامنة: ${stats.last_sync_at.slice(0, 16).replace('T', ' ')}` : 'لم تتم مزامنة بعد')
    : 'المزامنة غير مُفعّلة (أضف APIFY_TOKEN)';
  document.getElementById('reviewsMeta').textContent =
    `مراجعات يوم ${currentDate || ''} (${nf0.format(list.total)}) · ${syncInfo}`;
  document.getElementById('reviewsStrip').innerHTML =
    list.reviews.map(reviewCardHtml).join('') ||
    `<p class="muted">لا توجد مراجعات بتاريخ يوم العمل ${currentDate || ''}. (اضغط «مزامنة الآن» لجلب الأحدث)</p>`;
  return stats;
}

function pollSync() {
  const btn = document.getElementById('syncReviewsBtn');
  btn.disabled = true;
  btn.textContent = 'جارٍ المزامنة…';
  const timer = setInterval(async () => {
    const stats = await loadReviews();
    if (!stats.sync_running) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = 'مزامنة الآن';
      toast(stats.last_sync_status === 'ok' ? 'تمت مزامنة المراجعات بنجاح' : `المزامنة: ${stats.last_sync_status || 'انتهت'}`,
        stats.last_sync_status !== 'ok');
    }
  }, 8000);
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await initTopbar();
  isAdminViewer = user.role === 'admin';

  await loadTables();
  const dates = await loadDates();
  await loadReport(dates.length ? null : undefined);

  document.getElementById('dateSelect').addEventListener('change', (e) => loadReport(e.target.value));

  document.getElementById('saveTablesBtn').addEventListener('click', async () => {
    const n = Number(document.getElementById('tablesCount').value);
    if (!Number.isInteger(n) || n < 1) return toast('أدخل عدد طاولات صحيحاً', true);
    try {
      await api('/api/ops/settings', { method: 'PUT', body: { tables_count: n } });
      tablesCount = n;
      renderTableAvg();
      toast('تم حفظ عدد الطاولات');
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('saveNoteBtn').addEventListener('click', async () => {
    try {
      await api(`/api/ops/report/${currentDate}/notes`, { method: 'PUT', body: { notes: collectNotes(), deduction_notes: collectDeductionNotes(), actual_payments: collectActualPayments() } });
      toast('تم حفظ الملاحظات والجرد');
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('approveBtn').addEventListener('click', async () => {
    if (currentStatus === 'approved') return;
    if (!confirm(`اعتماد تقرير يوم ${currentDate} ونشره للإدارة؟\nلا يمكن التعديل عليه بعد الاعتماد.`)) return;
    try {
      await api(`/api/ops/report/${currentDate}/notes`, { method: 'PUT', body: { notes: collectNotes(), deduction_notes: collectDeductionNotes(), actual_payments: collectActualPayments() } }).catch(() => {});
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
