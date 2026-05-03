import { el, setView, pageHeader, field, input, select, toast, modal, confirmDialog, formatDate, severityPill } from '../ui.js';
import { store, uid } from '../store.js';
import { daysUntil } from '../ui.js';
import { navigate } from '../router.js';

const TYPES = [
  { value: 'commercial', label: 'سجل تجاري' },
  { value: 'chamber', label: 'عضوية الغرفة' },
];

const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

export function renderRegistrations() {
  const items = store.list('registrations');
  setView([
    pageHeader('السجلات', [
      el('button', { class: 'btn', onClick: () => openForm() }, '+ إضافة سجل'),
    ]),
    items.length === 0
      ? el('div', { class: 'empty' }, 'لا توجد سجلات بعد.')
      : el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'النوع'),
          el('th', {}, 'الرقم'),
          el('th', {}, 'تاريخ الإصدار'),
          el('th', {}, 'تاريخ الانتهاء'),
          el('th', {}, 'الحالة'),
          el('th', {}, 'إجراءات'),
        ])),
        el('tbody', {}, items.map((r) => el('tr', {}, [
          el('td', {}, TYPE_LABEL[r.type] || r.type),
          el('td', {}, r.number || '—'),
          el('td', {}, formatDate(r.issueDate)),
          el('td', {}, formatDate(r.expiryDate)),
          el('td', {}, severityPill(daysUntil(r.expiryDate))),
          el('td', {}, el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn-ghost btn-sm', onClick: () => openForm(r) }, 'تعديل'),
            el('button', { class: 'btn-danger btn-sm', onClick: async () => {
              if (await confirmDialog('حذف هذا السجل؟')) {
                store.remove('registrations', r.id);
                toast('تم الحذف', 'success');
                renderRegistrations();
              }
            } }, 'حذف'),
          ])),
        ]))),
      ])),
  ]);
}

export function renderRegistrationDetail({ params }) {
  const r = store.get('registrations', params.id);
  if (!r) { setView(el('div', { class: 'empty' }, 'السجل غير موجود.')); return; }
  openForm(r);
  navigate('#/registrations');
}

function openForm(existing) {
  const data = existing || {};
  const type = select(TYPES, { value: data.type || 'commercial' });
  const number = input({ value: data.number || '' });
  const issueDate = input({ type: 'date', value: data.issueDate || '' });
  const expiryDate = input({ type: 'date', value: data.expiryDate || '', required: '' });

  const m = modal({
    title: existing ? 'تعديل سجل' : 'إضافة سجل',
    body: el('div', { class: 'form-grid' }, [
      field('النوع', type),
      field('الرقم', number),
      field('تاريخ الإصدار', issueDate),
      field('تاريخ الانتهاء', expiryDate),
    ]),
    actions: [
      el('button', { type: 'button', class: 'btn-ghost', onClick: () => m.close() }, 'إلغاء'),
      el('button', { type: 'button', class: 'btn', onClick: save }, 'حفظ'),
    ],
  });

  function save() {
    if (!expiryDate.value) { toast('تاريخ الانتهاء مطلوب', 'error'); return; }
    const item = {
      id: existing?.id || uid('reg'),
      estId: store.currentEstId(),
      type: type.value,
      number: number.value.trim(),
      issueDate: issueDate.value,
      expiryDate: expiryDate.value,
      attachments: existing?.attachments || [],
    };
    store.upsert('registrations', item);
    toast('تم الحفظ', 'success');
    m.close();
    renderRegistrations();
  }
}
