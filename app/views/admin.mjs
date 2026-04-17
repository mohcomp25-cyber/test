import { html, raw, layout, formatDateTime, formatDate, escape } from '../lib/views.mjs';

export function loginPage({ flash }) {
  const body = html`
    <div class="card" style="max-width:420px;margin:40px auto">
      <h1>دخول الأدمن</h1>
      <form class="form" method="POST" action="/api/admin/login">
        <div>
          <label>اسم المستخدم</label>
          <input name="username" required>
        </div>
        <div>
          <label>كلمة المرور</label>
          <input name="password" type="password" required>
        </div>
        <button class="btn" type="submit">دخول</button>
      </form>
    </div>`;
  return layout({ title: 'دخول', body, flash });
}

export function dashboardPage({ stats, flash }) {
  const body = html`
    <h1>لوحة التحكم</h1>
    <div class="stats">
      <div class="stat"><div class="stat-num">${stats.campaigns}</div><div class="stat-label">عدد الحملات</div></div>
      <div class="stat"><div class="stat-num">${stats.activeCampaigns}</div><div class="stat-label">الحملات المفتوحة</div></div>
      <div class="stat"><div class="stat-num">${stats.pending}</div><div class="stat-label">طلبات معلّقة</div></div>
      <div class="stat"><div class="stat-num">${stats.approved}</div><div class="stat-label">مواعيد معتمدة</div></div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0">الإجراءات السريعة</h2>
        <div class="actions">
          <a class="btn" href="/admin/campaigns/new">+ حملة جديدة</a>
          <a class="btn btn-secondary" href="/admin/registrations">عرض السجلات</a>
        </div>
      </div>
    </div>`;
  return layout({ title: 'لوحة التحكم', body, admin: true, flash });
}

export function campaignsListPage({ campaigns, flash }) {
  const rows = campaigns.length === 0
    ? html`<tr><td colspan="5" class="meta">لا توجد حملات بعد.</td></tr>`
    : html`${campaigns.map(c => html`
        <tr>
          <td><strong>${c.title}</strong><br><span class="meta">${c.slug}</span></td>
          <td><span class="badge badge-${c.status}">${c.status === 'active' ? 'مفتوحة' : 'مغلقة'}</span></td>
          <td>${c.start_date ? formatDate(c.start_date) : '—'}</td>
          <td>${c.registrations_count}</td>
          <td class="actions">
            <a class="btn btn-sm btn-secondary" href="/admin/campaigns/${c.id}/edit">تعديل</a>
            <a class="btn btn-sm" href="/campaign/${c.slug}" target="_blank">عرض</a>
          </td>
        </tr>`)}`;

  const body = html`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h1>الحملات</h1>
      <a class="btn" href="/admin/campaigns/new">+ حملة جديدة</a>
    </div>
    <div class="card">
      <table class="table">
        <thead>
          <tr><th>العنوان</th><th>الحالة</th><th>تاريخ البدء</th><th>سجلات</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return layout({ title: 'الحملات', body, admin: true, flash });
}

export function campaignFormPage({ campaign, slots = [], flash, isNew }) {
  const action = isNew ? '/api/admin/campaigns' : `/api/admin/campaigns/${campaign.id}`;
  const c = campaign || { status: 'active' };

  const slotsBlock = isNew
    ? html`<p class="meta">احفظ الحملة أولاً لإضافة المواعيد.</p>`
    : html`
      <div class="card">
        <h2>الأوقات المتاحة</h2>
        ${slots.length === 0
          ? html`<p class="meta">لا توجد مواعيد مضافة بعد.</p>`
          : html`<table class="table">
              <thead><tr><th>الموعد</th><th>السعة</th><th></th></tr></thead>
              <tbody>${slots.map(s => html`
                <tr>
                  <td>${formatDateTime(s.slot_datetime)}</td>
                  <td>${s.capacity}</td>
                  <td>
                    <form class="inline-form" method="POST" action="/api/admin/slots/${s.id}/delete">
                      <button class="btn btn-sm btn-danger" type="submit">حذف</button>
                    </form>
                  </td>
                </tr>`)}</tbody>
            </table>`}

        <form class="form" method="POST" action="/api/admin/campaigns/${c.id}/slots" style="margin-top:16px">
          <div class="form-row">
            <div>
              <label>تاريخ ووقت الموعد</label>
              <input name="slot_datetime" type="datetime-local" required>
            </div>
            <div>
              <label>السعة (عدد الأشخاص المسموح)</label>
              <input name="capacity" type="number" min="1" value="1" required>
            </div>
          </div>
          <div><button class="btn" type="submit">+ إضافة موعد</button></div>
        </form>
      </div>`;

  const toDateValue = v => v ? new Date(v).toISOString().slice(0, 10) : '';

  const body = html`
    <h1>${isNew ? 'حملة جديدة' : 'تعديل الحملة'}</h1>
    <div class="card">
      <form class="form" method="POST" action="${action}">
        <div class="form-row">
          <div>
            <label>العنوان</label>
            <input name="title" required maxlength="120" value="${c.title || ''}">
          </div>
          <div>
            <label>المعرّف (slug)</label>
            <input name="slug" required maxlength="80" pattern="[a-z0-9-]+" value="${c.slug || ''}" placeholder="riyadh-campaign-2026">
          </div>
        </div>
        <div>
          <label>الهدف</label>
          <input name="goal" maxlength="200" value="${c.goal || ''}" placeholder="مثال: تغطية افتتاح المتجر">
        </div>
        <div>
          <label>الوصف</label>
          <textarea name="description" maxlength="1000">${c.description || ''}</textarea>
        </div>
        <div>
          <label>الموقع</label>
          <input name="location" maxlength="200" value="${c.location || ''}" placeholder="مثال: الرياض — بوليفارد">
        </div>
        <div class="form-row">
          <div>
            <label>تاريخ البدء</label>
            <input name="start_date" type="date" value="${toDateValue(c.start_date)}">
          </div>
          <div>
            <label>تاريخ الانتهاء</label>
            <input name="end_date" type="date" value="${toDateValue(c.end_date)}">
          </div>
        </div>
        <div>
          <label>الحالة</label>
          <select name="status">
            <option value="active" ${c.status === 'active' ? 'selected' : ''}>مفتوحة</option>
            <option value="closed" ${c.status === 'closed' ? 'selected' : ''}>مغلقة</option>
          </select>
        </div>
        <div class="actions">
          <button class="btn" type="submit">${isNew ? 'إنشاء' : 'حفظ التعديلات'}</button>
          <a class="btn btn-secondary" href="/admin/campaigns">رجوع</a>
        </div>
      </form>
    </div>
    ${slotsBlock}`;

  return layout({ title: isNew ? 'حملة جديدة' : 'تعديل الحملة', body, admin: true, flash });
}

export function registrationsPage({ registrations, flash, filter }) {
  const filterTabs = html`
    <div class="actions" style="margin-bottom:16px">
      <a class="btn btn-sm ${filter === 'all' ? '' : 'btn-secondary'}" href="/admin/registrations?filter=all">الكل</a>
      <a class="btn btn-sm ${filter === 'pending' ? '' : 'btn-secondary'}" href="/admin/registrations?filter=pending">معلّق</a>
      <a class="btn btn-sm ${filter === 'approved' ? '' : 'btn-secondary'}" href="/admin/registrations?filter=approved">معتمد</a>
      <a class="btn btn-sm ${filter === 'rejected' ? '' : 'btn-secondary'}" href="/admin/registrations?filter=rejected">مرفوض</a>
    </div>`;

  const statusLabel = s => s === 'pending' ? 'معلّق' : s === 'approved' ? 'معتمد' : 'مرفوض';

  const rows = registrations.length === 0
    ? html`<tr><td colspan="8" class="meta">لا توجد سجلات.</td></tr>`
    : html`${registrations.map(r => html`
        <tr>
          <td><strong>${r.full_name}</strong><br><span class="meta">${r.tiktok_username}</span></td>
          <td>${r.campaign_title}</td>
          <td>${r.slot_datetime ? formatDateTime(r.slot_datetime) : '—'}</td>
          <td>${r.followers_count ? r.followers_count.toLocaleString('ar-SA') : '—'}</td>
          <td dir="ltr">${r.whatsapp_number}</td>
          <td>${r.city || '—'}</td>
          <td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td>
          <td class="actions">
            ${r.status === 'pending' ? html`
              <form class="inline-form" method="POST" action="/api/admin/registrations/${r.id}/approve">
                <button class="btn btn-sm btn-success" type="submit">موافقة</button>
              </form>
              <form class="inline-form" method="POST" action="/api/admin/registrations/${r.id}/reject">
                <button class="btn btn-sm btn-danger" type="submit">رفض</button>
              </form>` : raw('—')}
          </td>
        </tr>`)}`;

  const body = html`
    <h1>سجلات التسجيل</h1>
    ${filterTabs}
    <div class="card" style="overflow-x:auto">
      <table class="table">
        <thead>
          <tr>
            <th>البلوقر</th><th>الحملة</th><th>الموعد</th><th>المتابعون</th>
            <th>واتساب</th><th>المدينة</th><th>الحالة</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  return layout({ title: 'السجلات', body, admin: true, flash });
}
