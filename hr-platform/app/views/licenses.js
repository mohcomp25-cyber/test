import { el, setView, pageHeader, field, input, select, toast, modal, confirmDialog, formatDate, severityPill, daysUntil } from '../ui.js';
import { store, uid } from '../store.js';
import { navigate } from '../router.js';

const TYPES = [
  { value: 'municipal', label: 'بلدي' },
  { value: 'civil_defense', label: 'دفاع مدني' },
  { value: 'other', label: 'أخرى' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

export function renderLicenses() {
  const items = store.list('licenses');
  const branches = store.list('branches');
  const branchById = Object.fromEntries(branches.map((b) => [b.id, b.name]));

  setView([
    pageHeader('التراخيص', [
      el('button', { class: 'btn', onClick: () => openForm() }, '+ إضافة ترخيص'),
    ]),
    items.length === 0
      ? el('div', { class: 'empty' }, 'لا توجد تراخيص بعد.')
      : el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'النوع'),
          el('th', {}, 'الجهة'),
          el('th', {}, 'الرقم'),
          el('th', {}, 'الفرع'),
          el('th', {}, 'الانتهاء'),
          el('th', {}, 'الحالة'),
          el('th', {}, 'إجراءات'),
        ])),
        el('tbody', {}, items.map((l) => el('tr', {}, [
          el('td', {}, TYPE_LABEL[l.type] || l.type),
          el('td', {}, l.authority || '—'),
          el('td', {}, l.number || '—'),
          el('td', {}, branchById[l.branchId] || '—'),
          el('td', {}, formatDate(l.expiryDate)),
          el('td', {}, severityPill(daysUntil(l.expiryDate))),
          el('td', {}, el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn-ghost btn-sm', onClick: () => openForm(l) }, 'تعديل'),
            el('button', { class: 'btn-danger btn-sm', onClick: async () => {
              if (await confirmDialog('حذف هذا الترخيص؟')) {
                store.remove('licenses', l.id);
                toast('تم الحذف', 'success');
                renderLicenses();
              }
            } }, 'حذف'),
          ])),
        ]))),
      ])),
  ]);
}

export function renderLicenseDetail({ params }) {
  const l = store.get('licenses', params.id);
  if (!l) { setView(el('div', { class: 'empty' }, 'الترخيص غير موجود.')); return; }
  openForm(l);
  navigate('#/licenses');
}

function openForm(existing) {
  const data = existing || {};
  const branches = store.list('branches');
  const branchOptions = [{ value: '', label: '— لا يوجد —' }, ...branches.map((b) => ({ value: b.id, label: b.name }))];

  const type = select(TYPES, { value: data.type || 'municipal' });
  const authority = input({ value: data.authority || '' });
  const number = input({ value: data.number || '' });
  const branchSel = select(branchOptions, { value: data.branchId || '' });
  const issueDate = input({ type: 'date', value: data.issueDate || '' });
  const expiryDate = input({ type: 'date', value: data.expiryDate || '', required: '' });

  const m = modal({
    title: existing ? 'تعديل ترخيص' : 'إضافة ترخيص',
    body: el('div', { class: 'form-grid' }, [
      field('النوع', type),
      field('الجهة المُصدِرة', authority, 'مثل: أمانة الرياض'),
      field('رقم الترخيص', number),
      field('الفرع', branchSel),
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
      id: existing?.id || uid('lic'),
      estId: store.currentEstId(),
      type: type.value,
      authority: authority.value.trim(),
      number: number.value.trim(),
      branchId: branchSel.value || null,
      issueDate: issueDate.value,
      expiryDate: expiryDate.value,
      attachments: existing?.attachments || [],
    };
    store.upsert('licenses', item);
    toast('تم الحفظ', 'success');
    m.close();
    renderLicenses();
  }
}
