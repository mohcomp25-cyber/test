import { el, setView, pageHeader, formatDate, confirmDialog, toast } from '../ui.js';
import { store } from '../store.js';
import { logChannelLabel } from '../notifications.js';

export function renderNotifications() {
  const log = store.state.activityLog;

  setView([
    pageHeader('سجل الإشعارات', [
      log.length > 0
        ? el('button', { class: 'btn-danger', onClick: async () => {
          if (await confirmDialog('مسح كل سجل الإشعارات؟')) {
            const snap = store.exportAll();
            snap.activityLog = [];
            store.importAll(snap);
            toast('تم المسح', 'success');
            renderNotifications();
          }
        } }, 'مسح السجل')
        : null,
    ]),
    el('div', { class: 'card' }, [
      el('p', { class: 'hint' }, 'هذا السجل يعرض الإشعارات التي أُرسلت من المنصة. في النموذج الأولي، الإيميل/SMS/واتساب يُسجّلون هنا فقط (محاكاة) — عند ربط باكند حقيقي ستُرسَل فعلياً للمستلمين.'),
      log.length === 0
        ? el('div', { class: 'empty' }, 'لا توجد إشعارات بعد.')
        : el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
          el('thead', {}, el('tr', {}, [
            el('th', {}, 'الوقت'),
            el('th', {}, 'القناة'),
            el('th', {}, 'المستلم'),
            el('th', {}, 'الموضوع'),
            el('th', {}, 'التفاصيل'),
            el('th', {}, 'الحالة'),
          ])),
          el('tbody', {}, log.map((a) => el('tr', {}, [
            el('td', {}, formatDate(a.ts)),
            el('td', {}, logChannelLabel(a.type)),
            el('td', {}, a.to || '—'),
            el('td', {}, a.subject || '—'),
            el('td', {}, a.body || '—'),
            el('td', {}, el('span', { class: 'pill pill-success' }, 'مُرسل (محاكاة)')),
          ]))),
        ])),
    ]),
  ]);
}
