import { el, setView, formatDate, severityPill, pageHeader } from '../ui.js';
import { computeAlerts, summaryStats, KIND_LABELS } from '../alerts.js';
import { sendBatchAlert } from '../notifications.js';
import { store } from '../store.js';
import { toast } from '../ui.js';

export function renderDashboard() {
  const stats = summaryStats();
  const groups = computeAlerts();

  const kpis = el('div', { class: 'kpi-grid' }, [
    kpi('🏢', stats.totals.branches, 'الفروع'),
    kpi('📜', stats.totals.registrations, 'السجلات'),
    kpi('🛡️', stats.totals.licenses, 'التراخيص'),
    kpi('👥', stats.totals.employees, 'العمالة'),
    kpi('🔴', stats.counts.expired || 0, 'منتهية'),
    kpi('🟠', stats.counts.urgent || 0, 'عاجلة (≤٣٠ يوم)'),
    kpi('🟡', stats.counts.soon || 0, 'قريبة (≤٩٠ يوم)'),
  ]);

  const cards = el('div', { class: 'alert-grid' }, [
    alertCard('السجلات التجارية', groups.registration),
    alertCard('التراخيص', groups.license),
    alertCard('إقامات العمالة', groups.iqama),
    alertCard('عقود العمل', groups.contract),
  ]);

  const recentActivity = recentActivityCard();

  setView([
    pageHeader('لوحة التحكم', [
      el('button', { class: 'btn', onClick: () => location.hash = '#/employees' }, '+ إضافة عامل'),
      el('button', { class: 'btn-secondary', onClick: () => location.hash = '#/import' }, 'استيراد Excel'),
    ]),
    kpis,
    cards,
    el('div', { class: 'dash-row' }, [
      criticalListCard(groups),
      recentActivity,
    ]),
  ]);
}

function kpi(icon, value, label) {
  return el('div', { class: 'kpi' }, [
    el('div', { class: 'kpi-icon' }, icon),
    el('div', {}, [
      el('div', { class: 'kpi-value' }, String(value)),
      el('div', { class: 'kpi-label' }, label),
    ]),
  ]);
}

function alertCard(title, items) {
  const needAttention = items.filter((i) => i.severity === 'expired' || i.severity === 'urgent' || i.severity === 'soon');
  const dominantSeverity = items.find((i) => i.severity === 'expired') ? 'expired'
    : items.find((i) => i.severity === 'urgent') ? 'urgent'
    : items.find((i) => i.severity === 'soon') ? 'soon'
    : 'ok';

  if (items.length === 0) {
    return el('div', { class: 'alert-card ok' }, [
      el('div', { class: 'alert-card-head' }, [el('span', {}, title), el('span', { class: 'count' }, '0')]),
      el('div', { class: 'empty' }, 'لا توجد بيانات بعد'),
    ]);
  }

  return el('div', { class: `alert-card ${dominantSeverity}` }, [
    el('div', { class: 'alert-card-head' }, [
      el('span', {}, title),
      el('span', { class: 'count' }, String(needAttention.length || items.length)),
    ]),
    el('ul', { class: 'alert-list' }, items.slice(0, 8).map((it) => el('li', {}, [
      el('div', {}, [
        el('a', { href: it.link }, it.title),
        el('div', { class: 'item-meta' }, [
          it.subtitle ? it.subtitle + ' · ' : '',
          'انتهاء: ', formatDate(it.expiry),
        ]),
      ]),
      severityPill(it.daysLeft),
    ]))),
    el('div', { class: 'alert-card-foot' }, [
      el('span', { class: 'kpi-label' }, items.length > 8 ? `+${items.length - 8} أخرى` : `${items.length} عنصر`),
      el('button', { class: 'btn-ghost btn-sm', onClick: () => {
        const sent = sendBatchAlert(needAttention, ['in-app', 'email', 'sms', 'whatsapp']);
        toast(`تم تسجيل ${sent} تنبيه (محاكاة)`, 'success');
      } }, 'إرسال تنبيهات'),
    ]),
  ]);
}

function criticalListCard(groups) {
  const all = Object.entries(groups).flatMap(([kind, arr]) =>
    arr.filter((i) => i.severity === 'expired' || i.severity === 'urgent')
       .map((i) => ({ ...i, kindLabel: KIND_LABELS[kind] }))
  ).sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999));

  return el('div', { class: 'card' }, [
    el('h3', { style: { marginTop: 0 } }, 'الإجراءات العاجلة'),
    all.length === 0
      ? el('p', { class: 'kpi-label' }, 'لا توجد وثائق منتهية أو قريبة الانتهاء.')
      : el('ul', { class: 'alert-list' }, all.slice(0, 12).map((it) => el('li', {}, [
        el('div', {}, [
          el('a', { href: it.link }, it.title),
          el('div', { class: 'item-meta' }, [
            it.kindLabel + (it.subtitle ? ' · ' + it.subtitle : '') + ' · ',
            'انتهاء: ', formatDate(it.expiry),
          ]),
        ]),
        severityPill(it.daysLeft),
      ]))),
  ]);
}

function recentActivityCard() {
  const log = store.state.activityLog.slice(0, 8);
  return el('div', { class: 'card' }, [
    el('h3', { style: { marginTop: 0 } }, 'آخر الإشعارات'),
    log.length === 0
      ? el('p', { class: 'kpi-label' }, 'لم يتم إرسال إشعارات بعد.')
      : el('ul', { class: 'activity-list' }, log.map((a) => el('li', {}, [
        el('div', { class: 'ts' }, formatDate(a.ts) + ' · ' + (a.type === 'in-app' ? 'داخل المنصة' : a.type)),
        el('div', {}, a.subject),
      ]))),
    el('a', { href: '#/notifications' }, 'عرض كل الإشعارات →'),
  ]);
}
