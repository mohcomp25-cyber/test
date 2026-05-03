import { el, setView, pageHeader, field, input, select, toast, modal, confirmDialog, formatDate, severityPill, daysUntil } from '../ui.js';
import { store, uid } from '../store.js';
import { exportEmployeesExcel } from '../excel.js';

const CONTRACT_TYPES = [
  { value: 'محدد', label: 'محدد المدة' },
  { value: 'غير محدد', label: 'غير محدد المدة' },
];

export function renderEmployees() {
  const items = store.list('employees');
  const branches = store.list('branches');
  const branchById = Object.fromEntries(branches.map((b) => [b.id, b.name]));

  const search = input({ placeholder: 'بحث بالاسم أو رقم الإقامة...' });
  const branchFilter = select(
    [{ value: '', label: 'كل الفروع' }, ...branches.map((b) => ({ value: b.id, label: b.name }))],
    {}
  );

  const tableHost = el('div', {});

  function rerender() {
    const q = search.value.trim().toLowerCase();
    const bf = branchFilter.value;
    const filtered = items.filter((e) => {
      if (bf && e.branchId !== bf) return false;
      if (q && !`${e.fullName} ${e.iqamaNumber} ${e.phone}`.toLowerCase().includes(q)) return false;
      return true;
    });
    tableHost.replaceChildren(buildTable(filtered, branchById));
  }
  search.addEventListener('input', rerender);
  branchFilter.addEventListener('change', rerender);

  setView([
    pageHeader('العمالة', [
      el('button', { class: 'btn', onClick: () => openForm() }, '+ إضافة عامل'),
      el('button', { class: 'btn-secondary', onClick: () => exportEmployeesExcel() }, 'تصدير Excel'),
    ]),
    el('div', { class: 'search-bar' }, [search, branchFilter]),
    tableHost,
  ]);
  rerender();
}

function buildTable(items, branchById) {
  if (items.length === 0) return el('div', { class: 'empty' }, 'لا توجد بيانات.');
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'الاسم'),
      el('th', {}, 'الفرع'),
      el('th', {}, 'الوظيفة'),
      el('th', {}, 'رقم الإقامة'),
      el('th', {}, 'انتهاء الإقامة'),
      el('th', {}, 'انتهاء العقد'),
      el('th', {}, 'إجراءات'),
    ])),
    el('tbody', {}, items.map((e) => el('tr', {}, [
      el('td', {}, [
        el('a', { href: `#/employees/${e.id}` }, e.fullName),
        el('div', { class: 'item-meta' }, e.nationality || ''),
      ]),
      el('td', {}, branchById[e.branchId] || '—'),
      el('td', {}, e.jobTitle || '—'),
      el('td', {}, e.iqamaNumber || '—'),
      el('td', {}, [
        formatDate(e.iqamaExpiry), ' ',
        e.iqamaExpiry ? severityPill(daysUntil(e.iqamaExpiry)) : null,
      ]),
      el('td', {}, [
        formatDate(e.contractEnd), ' ',
        e.contractEnd ? severityPill(daysUntil(e.contractEnd)) : null,
      ]),
      el('td', {}, el('div', { class: 'btn-row' }, [
        el('a', { class: 'btn-ghost btn-sm', href: `#/employees/${e.id}` }, 'تفاصيل'),
        el('button', { class: 'btn-danger btn-sm', onClick: async () => {
          if (await confirmDialog('حذف هذا العامل؟')) {
            store.remove('employees', e.id);
            toast('تم الحذف', 'success');
            renderEmployees();
          }
        } }, 'حذف'),
      ])),
    ]))),
  ]));
}

export function openForm(existing) {
  const data = existing || {};
  const branches = store.list('branches');
  const branchOptions = [{ value: '', label: '— بدون فرع —' }, ...branches.map((b) => ({ value: b.id, label: b.name }))];

  const fullName = input({ value: data.fullName || '', required: '' });
  const nationality = input({ value: data.nationality || '' });
  const branchSel = select(branchOptions, { value: data.branchId || '' });
  const jobTitle = input({ value: data.jobTitle || '' });
  const salary = input({ value: data.salary || '', type: 'number', min: '0' });
  const phone = input({ value: data.phone || '', type: 'tel' });
  const iqamaNumber = input({ value: data.iqamaNumber || '' });
  const iqamaExpiry = input({ type: 'date', value: data.iqamaExpiry || '' });
  const contractStart = input({ type: 'date', value: data.contractStart || '' });
  const contractEnd = input({ type: 'date', value: data.contractEnd || '' });
  const contractType = select([{ value: '', label: '—' }, ...CONTRACT_TYPES], { value: data.contractType || '' });

  const m = modal({
    title: existing ? 'تعديل عامل' : 'إضافة عامل',
    body: el('div', { class: 'form-grid' }, [
      field('الاسم الكامل', fullName),
      field('الجنسية', nationality),
      field('الفرع', branchSel),
      field('الوظيفة', jobTitle),
      field('الراتب', salary),
      field('الجوال', phone),
      field('رقم الإقامة', iqamaNumber),
      field('انتهاء الإقامة', iqamaExpiry),
      field('بداية العقد', contractStart),
      field('نهاية العقد', contractEnd),
      field('نوع العقد', contractType),
    ]),
    actions: [
      el('button', { type: 'button', class: 'btn-ghost', onClick: () => m.close() }, 'إلغاء'),
      el('button', { type: 'button', class: 'btn', onClick: save }, 'حفظ'),
    ],
  });

  function save() {
    if (!fullName.value.trim()) { toast('الاسم الكامل مطلوب', 'error'); return; }
    const item = {
      id: existing?.id || uid('emp'),
      estId: store.currentEstId(),
      branchId: branchSel.value || null,
      fullName: fullName.value.trim(),
      nationality: nationality.value.trim(),
      jobTitle: jobTitle.value.trim(),
      salary: salary.value,
      phone: phone.value.trim(),
      iqamaNumber: iqamaNumber.value.trim(),
      iqamaExpiry: iqamaExpiry.value,
      contractStart: contractStart.value,
      contractEnd: contractEnd.value,
      contractType: contractType.value,
      attachments: existing?.attachments || [],
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    store.upsert('employees', item);
    toast('تم الحفظ', 'success');
    m.close();
    renderEmployees();
  }
}
