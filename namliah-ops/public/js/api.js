'use strict';

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `خطأ ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money = (n) => `${nf.format(n || 0)} ر.س`;

const MIX_LABELS = {
  cash: 'نقدي', card: 'شبكة/بطاقة', online: 'دفع إلكتروني', other: 'أخرى',
  dine_in: 'صالة', hall: 'صالة', takeaway: 'استلام', qlub: 'قلب (دفع QR)',
  coupons: 'كوبونات', discounts: 'خصومات', cancellations: 'إلغاءات'
};
const mixLabel = (k) => MIX_LABELS[String(k).split(':').pop()] || String(k).split(':').pop();

function flattenMix(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v && typeof v === 'object') Object.assign(out, flattenMix(v, k));
    else if (typeof v === 'number') out[prefix ? `${prefix}:${k}` : k] = v;
  }
  return out;
}

// لوحة مُتحقق منها (CVD + تباين) على أسطح هوية نملية
const CHART_COLORS = ['#5F7A26', '#A24C5E', '#96690F', '#058E7E', '#B5612C'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function starsHtml(rating) {
  return `<span class="stars">${'★'.repeat(rating)}<span class="off">${'★'.repeat(5 - rating)}</span></span>`;
}

let toastTimer;
function toast(message, isError = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function renderMixList(container, mix) {
  const flat = Object.entries(flattenMix(mix)).sort((a, b) => b[1] - a[1]);
  if (!flat.length) {
    container.innerHTML = '<p class="muted">لا توجد بيانات</p>';
    return;
  }
  const sum = flat.reduce((a, [, v]) => a + v, 0) || 1;
  container.innerHTML = flat.map(([k, v], i) => `
    <div class="mix-row">
      <span class="mix-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
      <span class="mix-name">${esc(mixLabel(k))}</span>
      <span class="mix-val">${money(v)}</span>
      <span class="mix-pct">${nf.format((v / sum) * 100)}٪</span>
    </div>`).join('');
}

// شرائح مضغوطة (لبطاقة طرق الدفع المصغّرة)
function renderChips(container, mix) {
  const flat = Object.entries(flattenMix(mix)).sort((a, b) => b[1] - a[1]);
  if (!flat.length) {
    container.innerHTML = '<span class="muted">لا توجد بيانات</span>';
    return;
  }
  const sum = flat.reduce((a, [, v]) => a + v, 0) || 1;
  container.innerHTML = flat.map(([k, v], i) => `
    <span class="chip">
      <span class="dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
      ${esc(mixLabel(k))}
      <b>${money(v)}</b>
      <span class="pct">${nf.format((v / sum) * 100)}٪</span>
    </span>`).join('');
}

function reviewCardHtml(r) {
  const sentimentLabel = { positive: 'إيجابي', neutral: 'محايد', negative: 'سلبي' }[r.sentiment];
  const initial = (r.author_name || 'ز').trim().charAt(0);
  const photos = (r.photos || []).slice(0, 4).map((p) =>
    `<img src="${esc(p)}" alt="صورة من المراجعة" loading="lazy" onclick="window.open('${esc(p)}','_blank')">`
  ).join('');
  return `
    <div class="review-card review-card--${esc(r.sentiment)}">
      <div class="review-head">
        <div class="review-avatar">${r.author_photo_url ? `<img src="${esc(r.author_photo_url)}" alt="">` : esc(initial)}</div>
        <div class="review-meta">
          <div class="review-author">${esc(r.author_name || 'زائر')}</div>
          <div class="review-date">${esc(r.review_date || '')}</div>
        </div>
        <span class="sentiment-tag sentiment-tag--${esc(r.sentiment)}">${sentimentLabel}</span>
      </div>
      ${starsHtml(r.rating)}
      ${r.text ? `<div class="review-text">${esc(r.text)}</div>` : ''}
      ${photos ? `<div class="review-photos">${photos}</div>` : ''}
      ${r.owner_reply ? `<div class="owner-reply"><b>رد المطعم:</b> ${esc(r.owner_reply)}</div>` : ''}
    </div>`;
}

async function initTopbar() {
  const user = await api('/api/auth/me');
  const el = document.getElementById('userName');
  if (el) el.textContent = user.displayName;
  const badge = document.getElementById('branchBadge');
  if (badge && user.branchName) badge.textContent = `فرع ${user.branchName}`;
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  });
  return user;
}
