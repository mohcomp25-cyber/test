'use strict';
// منطق داشبورد الإدارة

const charts = {};
let currentSentiment = '';
let reviewsPage = 1;
let currentBranch = 'all';
let currentRange = null;

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function makeChart(id, config) {
  destroyChart(id);
  charts[id] = new Chart(document.getElementById(id), config);
}

function rangeDates(days) {
  const to = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const from = new Date(Date.now() + 3 * 3600 * 1000 - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

function moneyTick(v) {
  return v >= 1000 ? `${nf.format(v / 1000)}k` : nf0.format(v);
}

async function loadDashboard(from, to) {
  currentRange = { from, to };
  const data = await api(`/api/admin/dashboard?from=${from}&to=${to}&branch=${currentBranch}`);

  // KPIs
  document.getElementById('kpiSales').textContent = money(data.totals.total_sales);
  document.getElementById('kpiOrders').textContent = nf0.format(data.totals.orders_count);
  document.getElementById('kpiAvg').textContent = money(data.totals.avg_ticket);
  document.getElementById('kpiDaily').textContent = money(data.totals.avg_daily_sales);
  document.getElementById('kpiDays').textContent = `${nf0.format(data.totals.days)} يوم معتمد في المدى المحدد`;
  const ded = data.deductionsMix || {};
  document.getElementById('kpiDeductions').innerHTML = [
    ['كوبونات', ded.coupons], ['خصومات', ded.discounts], ['إلغاءات', ded.cancellations]
  ].map(([label, v]) => `<span>${label}: <b>${money(v || 0)}</b></span>`).join('');
  if (data.reviews.count > 0) {
    document.getElementById('kpiRating').innerHTML =
      `${nf.format(data.reviews.avg_rating)} <small>من ٥</small>`;
    document.getElementById('kpiRatingSub').innerHTML =
      `<span class="up">▲ ${nf0.format(data.reviews.positive)} إيجابي</span> · <span class="down">▼ ${nf0.format(data.reviews.negative)} سلبي</span>`;
  }

  // اتجاه المبيعات — سلسلة واحدة: بدون صندوق مفتاح، العنوان يكفي
  makeChart('trendChart', {
    type: 'line',
    data: {
      labels: data.trend.map((t) => t.date),
      datasets: [{
        label: 'المبيعات',
        data: data.trend.map((t) => t.total_sales),
        borderColor: CHART_COLORS[0],
        backgroundColor: 'rgba(90, 122, 52, 0.10)',
        pointBackgroundColor: CHART_COLORS[0],
        fill: true
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${money(c.parsed.y)}` } }
      },
      scales: {
        x: { reverse: true, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: moneyTick } }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });

  // أفضل ١٠ أصناف — أسماء (nominal): لون واحد للسلسلة كلها
  makeChart('topProductsChart', {
    type: 'bar',
    data: {
      labels: data.topProducts.map((p) => p.product_name),
      datasets: [{
        label: 'المبيعات',
        data: data.topProducts.map((p) => p.total),
        backgroundColor: CHART_COLORS[0],
        maxBarThickness: 22
      }]
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => ` ${money(c.parsed.x)} — الكمية ${nf0.format(data.topProducts[c.dataIndex].qty)}`
          }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: moneyTick }, position: 'top' },
        y: { grid: { display: false } }
      }
    }
  });

  // مزيج التصنيفات
  makeChart('categoryChart', {
    type: 'bar',
    data: {
      labels: data.categoryMix.map((c) => c.category),
      datasets: [{
        label: 'المبيعات',
        data: data.categoryMix.map((c) => c.total),
        backgroundColor: CHART_COLORS[1],
        maxBarThickness: 22
      }]
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${money(c.parsed.x)}` } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: moneyTick }, position: 'top' },
        y: { grid: { display: false } }
      }
    }
  });

  // دونات: طرق الدفع وقنوات البيع — مفتاح دائم لأن الهوية بالألوان
  const doughnut = (id, mix) => {
    const flat = Object.entries(flattenMix(mix)).sort((a, b) => b[1] - a[1]);
    makeChart(id, {
      type: 'doughnut',
      data: {
        labels: flat.map(([k]) => mixLabel(k)),
        datasets: [{
          data: flat.map(([, v]) => v),
          backgroundColor: flat.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
        }]
      },
      options: {
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (c) => {
                const sum = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
                return ` ${money(c.parsed)} (${nf.format((c.parsed / sum) * 100)}٪)`;
              }
            }
          }
        }
      }
    });
  };
  doughnut('paymentChart', data.paymentMix);
  doughnut('channelChart', data.externalMix);

  // مبيعات الصالة حسب الويتر — سلسلة اسمية واحدة: لون واحد
  const waiters = data.waiters || [];
  makeChart('waitersChart', {
    type: 'bar',
    data: {
      labels: waiters.map((w) => w.waiter),
      datasets: [{
        label: 'المبيعات',
        data: waiters.map((w) => w.total),
        backgroundColor: CHART_COLORS[3],
        maxBarThickness: 22
      }]
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${money(c.parsed.x)}` } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: moneyTick }, position: 'top' },
        y: { grid: { display: false } }
      }
    }
  });

  // جدول التقارير المعتمدة
  const reportsList = await api(`/api/admin/reports?from=${from}&to=${to}&branch=${currentBranch}`);
  document.getElementById('reportsBody').innerHTML = reportsList.reports.map((r) => `
    <tr>
      <td><b>${r.report_date}</b></td>
      <td class="num">${money(r.total_sales)}</td>
      <td class="num">${nf0.format(r.orders_count)}</td>
      <td class="num">${money(r.avg_ticket)}</td>
      <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.note_preview || '—')}</td>
      <td><a class="btn btn--outline btn--sm" href="/report/${r.report_date}/print?branch=${r.branch}" target="_blank">عرض / طباعة</a></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:30px">لا توجد تقارير معتمدة في هذا المدى</td></tr>';

  // تغذية الملاحظات المصنفة
  const CAT_LABELS = {
    customers: 'زبائن', operations: 'تشغيل', kitchen: 'مطبخ',
    maintenance: 'صيانة', general: 'عام'
  };
  document.getElementById('notesFeed').innerHTML = data.notesFeed.map((n) => `
    <div class="note-item">
      <div class="note-date">${n.report_date} — ${esc(n.author)}<span class="note-cat">${CAT_LABELS[n.category] || esc(n.category)}</span></div>
      <div>${esc(n.body)}</div>
    </div>`).join('') || '<p class="muted">لا توجد ملاحظات في هذا المدى</p>';
}

async function loadReviews(reset = true) {
  if (reset) reviewsPage = 1;
  const data = await api(`/api/reviews?page=${reviewsPage}&branch=${currentBranch}${currentSentiment ? `&sentiment=${currentSentiment}` : ''}`);
  const grid = document.getElementById('reviewsGrid');
  const html = data.reviews.map(reviewCardHtml).join('');
  if (reset) grid.innerHTML = html || '<p class="muted">لا توجد مراجعات مطابقة</p>';
  else grid.insertAdjacentHTML('beforeend', html);
  document.getElementById('moreReviewsBtn').style.display = reviewsPage < data.pages ? 'inline-flex' : 'none';

  const stats = await api(`/api/reviews/stats?branch=${currentBranch}`);
  document.getElementById('reviewsMeta').textContent = stats.configured
    ? (stats.last_sync_at ? `آخر مزامنة: ${stats.last_sync_at.slice(0, 16).replace('T', ' ')}` : 'لم تتم مزامنة بعد')
    : 'المزامنة غير مُفعّلة (أضف APIFY_TOKEN في الخادم)';
  return stats;
}

document.addEventListener('DOMContentLoaded', async () => {
  await initTopbar();

  let { from, to } = rangeDates(30);
  document.getElementById('fromDate').value = from;
  document.getElementById('toDate').value = to;
  await loadDashboard(from, to);
  loadReviews().catch(() => {});

  document.querySelectorAll('.filter-chip[data-branch]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      document.querySelectorAll('.filter-chip[data-branch]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentBranch = chip.dataset.branch;
      await loadDashboard(currentRange.from, currentRange.to);
      loadReviews().catch(() => {});
    });
  });

  document.querySelectorAll('.filter-chip[data-days]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      document.querySelectorAll('.filter-chip[data-days]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const r = rangeDates(Number(chip.dataset.days));
      document.getElementById('fromDate').value = r.from;
      document.getElementById('toDate').value = r.to;
      await loadDashboard(r.from, r.to);
    });
  });

  document.getElementById('applyRange').addEventListener('click', async () => {
    const f = document.getElementById('fromDate').value;
    const t = document.getElementById('toDate').value;
    if (!f || !t) return toast('حدد تاريخي البداية والنهاية', true);
    document.querySelectorAll('.filter-chip[data-days]').forEach((c) => c.classList.remove('active'));
    await loadDashboard(f, t);
  });

  document.querySelectorAll('.filter-chip[data-sentiment]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip[data-sentiment]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentSentiment = chip.dataset.sentiment;
      loadReviews();
    });
  });

  document.getElementById('moreReviewsBtn').addEventListener('click', () => {
    reviewsPage++;
    loadReviews(false);
  });

  document.getElementById('syncReviewsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncReviewsBtn');
    try {
      await api(`/api/reviews/sync?branch=${currentBranch}`, { method: 'POST' });
      toast('بدأت المزامنة — قد تستغرق دقيقة إلى دقيقتين');
      btn.disabled = true;
      btn.textContent = '⏳ جارٍ المزامنة…';
      const timer = setInterval(async () => {
        const stats = await loadReviews();
        if (!stats.sync_running) {
          clearInterval(timer);
          btn.disabled = false;
          btn.textContent = '↻ مزامنة الآن';
          toast(stats.last_sync_status === 'ok' ? 'تمت المزامنة بنجاح' : `المزامنة: ${stats.last_sync_status || 'انتهت'}`,
            stats.last_sync_status !== 'ok');
        }
      }, 8000);
    } catch (err) { toast(err.message, true); }
  });
});
