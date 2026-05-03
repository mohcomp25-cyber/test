import { el, setView, pageHeader, field, input, toast, modal, confirmDialog } from '../ui.js';
import { store, uid } from '../store.js';
import { navigate } from '../router.js';

export function renderBranches() {
  const items = store.list('branches');
  setView([
    pageHeader('الفروع', [
      el('button', { class: 'btn', onClick: () => openBranchForm() }, '+ إضافة فرع'),
    ]),
    items.length === 0
      ? el('div', { class: 'empty' }, 'لا توجد فروع بعد. ابدأ بإضافة فرع.')
      : el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'الاسم'),
          el('th', {}, 'المدينة'),
          el('th', {}, 'العنوان'),
          el('th', {}, 'المدير'),
          el('th', {}, 'الجوال'),
          el('th', {}, 'إجراءات'),
        ])),
        el('tbody', {}, items.map((b) => el('tr', {}, [
          el('td', {}, b.name),
          el('td', {}, b.city || '—'),
          el('td', {}, b.address || '—'),
          el('td', {}, b.managerName || '—'),
          el('td', {}, b.phone || '—'),
          el('td', {}, el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn-ghost btn-sm', onClick: () => openBranchForm(b) }, 'تعديل'),
            el('button', { class: 'btn-danger btn-sm', onClick: async () => {
              if (await confirmDialog('حذف هذا الفرع؟')) {
                store.remove('branches', b.id);
                toast('تم الحذف', 'success');
                renderBranches();
              }
            } }, 'حذف'),
          ])),
        ]))),
      ])),
  ]);
}

export function renderBranchDetail({ params }) {
  const b = store.get('branches', params.id);
  if (!b) {
    setView(el('div', { class: 'empty' }, 'الفرع غير موجود.'));
    return;
  }
  openBranchForm(b);
  navigate('#/branches');
}

function openBranchForm(existing) {
  const data = existing || {};
  const name = input({ value: data.name || '', required: '' });
  const city = input({ value: data.city || '' });
  const address = input({ value: data.address || '' });
  const manager = input({ value: data.managerName || '' });
  const phone = input({ value: data.phone || '', type: 'tel' });

  const m = modal({
    title: existing ? 'تعديل فرع' : 'إضافة فرع',
    body: el('form', { id: 'branch-form', onSubmit: (e) => { e.preventDefault(); save(); } }, [
      el('div', { class: 'form-grid' }, [
        field('اسم الفرع', name),
        field('المدينة', city),
        field('العنوان', address),
        field('اسم المدير', manager),
        field('جوال المدير', phone),
      ]),
    ]),
    actions: [
      el('button', { type: 'button', class: 'btn-ghost', onClick: () => m.close() }, 'إلغاء'),
      el('button', { type: 'button', class: 'btn', onClick: save }, 'حفظ'),
    ],
  });

  function save() {
    if (!name.value.trim()) { toast('اسم الفرع مطلوب', 'error'); return; }
    const item = {
      id: existing?.id || uid('br'),
      estId: store.currentEstId(),
      name: name.value.trim(),
      city: city.value.trim(),
      address: address.value.trim(),
      managerName: manager.value.trim(),
      phone: phone.value.trim(),
    };
    store.upsert('branches', item);
    toast('تم الحفظ', 'success');
    m.close();
    renderBranches();
  }
}
