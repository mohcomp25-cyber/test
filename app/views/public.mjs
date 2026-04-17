import { html, raw, layout, formatDate, formatDateTime } from '../lib/views.mjs';

export function homePage({ campaigns, flash }) {
  const cards = campaigns.length === 0
    ? html`<p class="meta">لا توجد حملات منشورة حالياً.</p>`
    : html`<div class="grid">${campaigns.map(c => html`
        <a href="/campaign/${c.slug}" class="card card-hover" style="display:block">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
            <h2 style="margin:0">${c.title}</h2>
            <span class="badge badge-${c.status}">${c.status === 'active' ? 'مفتوحة' : 'مغلقة'}</span>
          </div>
          <p class="meta">${c.goal || ''}</p>
          <p class="meta">
            ${c.start_date ? raw(`<strong>من:</strong> ${formatDate(c.start_date)}`) : ''}
            ${c.end_date ? raw(` &nbsp; <strong>إلى:</strong> ${formatDate(c.end_date)}`) : ''}
          </p>
          <p class="meta">${c.location ? raw(`<strong>الموقع:</strong> ${c.location}`) : ''}</p>
        </a>`)}</div>`;

  const body = html`
    <section style="margin-bottom:24px">
      <h1>الحملات المفتوحة للتسجيل</h1>
      <p class="meta">اختر الحملة اللي تناسبك واحجز موعد حضورك.</p>
    </section>
    ${cards}
  `;
  return layout({ title: 'الرئيسية', body, flash });
}

export function campaignPage({ campaign, slots, flash }) {
  if (!campaign) {
    return layout({
      title: 'غير موجود',
      body: html`<div class="card"><h1>الحملة غير موجودة</h1><p class="meta">الرابط غير صحيح أو تم حذف الحملة.</p></div>`,
      flash,
    });
  }

  const closed = campaign.status !== 'active';

  const slotInputs = slots.length === 0
    ? html`<p class="meta">لا توجد مواعيد متاحة بعد.</p>`
    : html`<div class="slot-options">${slots.map(s => {
        const full = s.available <= 0;
        return html`
          <label class="slot-option ${full ? 'full' : ''}">
            <input type="radio" name="slot_id" value="${s.id}" ${full ? 'disabled' : ''} required>
            <div class="slot-label">
              <div><strong>${formatDateTime(s.slot_datetime)}</strong></div>
              <div class="meta">
                ${full ? raw('<span class="slot-full-tag">مكتمل</span>') : `متاح: ${s.available} من ${s.capacity}`}
              </div>
            </div>
          </label>`;
      })}</div>`;

  const body = html`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;flex-wrap:wrap">
        <h1 style="margin:0">${campaign.title}</h1>
        <span class="badge badge-${campaign.status}">${closed ? 'مغلقة' : 'مفتوحة للتسجيل'}</span>
      </div>
      ${campaign.goal ? html`<p><strong>الهدف:</strong> ${campaign.goal}</p>` : raw('')}
      ${campaign.description ? html`<p>${campaign.description}</p>` : raw('')}
      <p class="meta">
        ${campaign.location ? raw(`<strong>الموقع:</strong> ${campaign.location}`) : ''}
        ${campaign.start_date ? raw(` &nbsp; <strong>من:</strong> ${formatDate(campaign.start_date)}`) : ''}
        ${campaign.end_date ? raw(` &nbsp; <strong>إلى:</strong> ${formatDate(campaign.end_date)}`) : ''}
      </p>
    </div>

    ${closed ? html`<div class="card"><p>هذه الحملة مغلقة حالياً. تابعنا لأخبار الحملات القادمة.</p></div>` : html`
    <div class="card">
      <h2>تسجيل الحضور</h2>
      <form class="form" method="POST" action="/api/register">
        <input type="hidden" name="campaign_id" value="${campaign.id}">
        <div class="form-row">
          <div>
            <label>الاسم الكامل</label>
            <input name="full_name" required maxlength="120" placeholder="مثال: محمد العتيبي">
          </div>
          <div>
            <label>اسم المستخدم في تيك توك</label>
            <input name="tiktok_username" required maxlength="80" placeholder="@username">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label>عدد المتابعين</label>
            <input name="followers_count" type="number" min="0" placeholder="مثال: 50000">
          </div>
          <div>
            <label>رقم الواتساب</label>
            <input name="whatsapp_number" required placeholder="05xxxxxxxx" inputmode="tel">
          </div>
        </div>
        <div>
          <label>المدينة</label>
          <input name="city" maxlength="80" placeholder="مثال: الرياض">
        </div>
        <div>
          <label>اختر موعد الحضور</label>
          ${slotInputs}
        </div>
        <div>
          <label>ملاحظات (اختياري)</label>
          <textarea name="notes" maxlength="500"></textarea>
        </div>
        <div>
          <button type="submit" class="btn">إرسال التسجيل</button>
        </div>
      </form>
    </div>`}
  `;

  return layout({ title: campaign.title, body, flash });
}

export function registrationSuccessPage({ campaign }) {
  const body = html`
    <div class="card">
      <h1>تم استلام طلبك</h1>
      <p>شكراً لك. سيتم مراجعة طلبك، وستصلك رسالة تأكيد عبر الواتساب عند الموافقة على حضورك في حملة "${campaign?.title || ''}".</p>
      <a class="btn btn-secondary" href="/">رجوع للرئيسية</a>
    </div>`;
  return layout({ title: 'تم الإرسال', body });
}
