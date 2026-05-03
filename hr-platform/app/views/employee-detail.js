import { el, setView, pageHeader, formatDate, severityPill, daysUntil, addMonths, toast, modal, input, field, todayISO } from '../ui.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { openForm } from './employees.js';

export function renderEmployeeDetail({ params }) {
  const e = store.get('employees', params.id);
  if (!e) {
    setView(el('div', { class: 'empty' }, 'العامل غير موجود.'));
    return;
  }
  const branch = e.branchId ? store.get('branches', e.branchId) : null;

  const detail = el('div', { class: 'detail-grid' }, [
    item('الاسم', e.fullName),
    item('الجنسية', e.nationality),
    item('الفرع', branch?.name || '—'),
    item('الوظيفة', e.jobTitle),
    item('الراتب', e.salary ? `${e.salary} ر.س` : '—'),
    item('الجوال', e.phone),
    item('رقم الإقامة', e.iqamaNumber),
    item('نوع العقد', e.contractType || '—'),
  ]);

  const iqamaSection = renewSection({
    title: 'الإقامة',
    expiryLabel: 'تاريخ انتهاء الإقامة',
    expiryValue: e.iqamaExpiry,
    onRenew: (newDate, monthsAdded) => {
      store.upsert('employees', { ...e, iqamaExpiry: newDate });
      store.appendActivity({
        type: 'in-app', to: 'سجل النظام',
        subject: `تجديد إقامة ${e.fullName}`,
        body: `تم تمديد الإقامة ${monthsAdded} شهر حتى ${newDate}`,
        status: 'mock-sent',
      });
      toast(`تم تجديد الإقامة (+${monthsAdded} شهر)`, 'success');
      renderEmployeeDetail({ params });
    },
  });

  const contractSection = renewSection({
    title: 'عقد العمل',
    expiryLabel: 'تاريخ انتهاء العقد',
    expiryValue: e.contractEnd,
    onRenew: (newDate, monthsAdded) => {
      store.upsert('employees', { ...e, contractEnd: newDate });
      store.appendActivity({
        type: 'in-app', to: 'سجل النظام',
        subject: `تجديد عقد ${e.fullName}`,
        body: `تم تمديد العقد ${monthsAdded} شهر حتى ${newDate}`,
        status: 'mock-sent',
      });
      toast(`تم تجديد العقد (+${monthsAdded} شهر)`, 'success');
      renderEmployeeDetail({ params });
    },
  });

  setView([
    pageHeader('تفاصيل العامل', [
      el('button', { class: 'btn-secondary', onClick: () => navigate('#/employees') }, '→ القائمة'),
      el('button', { class: 'btn', onClick: () => {
        openForm(e);
        // After modal closes, re-render
        setTimeout(() => renderEmployeeDetail({ params }), 50);
      } }, 'تعديل البيانات'),
    ]),
    detail,
    iqamaSection,
    contractSection,
  ]);
}

function item(label, value) {
  return el('div', {}, [
    el('div', { class: 'label' }, label),
    el('div', { class: 'val' }, value || '—'),
  ]);
}

function renewSection({ title, expiryLabel, expiryValue, onRenew }) {
  const days = expiryValue ? daysUntil(expiryValue) : null;
  return el('div', { class: 'card', style: { marginTop: '14px' } }, [
    el('h3', { style: { marginTop: 0 } }, title),
    el('div', { class: 'detail-grid', style: { padding: 0, border: 0 } }, [
      item(expiryLabel, formatDate(expiryValue)),
      el('div', {}, [
        el('div', { class: 'label' }, 'الحالة'),
        el('div', {}, expiryValue ? severityPill(days) : el('span', { class: 'pill pill-muted' }, 'غير محدد')),
      ]),
    ]),
    el('div', { class: 'renew-bar' }, [
      el('span', { class: 'label' }, 'تجديد سريع:'),
      renewBtn(3, expiryValue, onRenew),
      renewBtn(6, expiryValue, onRenew),
      renewBtn(12, expiryValue, onRenew),
      el('button', { class: 'btn-secondary btn-sm', onClick: () => openCustomRenew(expiryValue, onRenew) }, 'تاريخ مخصص'),
    ]),
  ]);
}

function renewBtn(months, current, onRenew) {
  return el('button', {
    class: 'btn btn-sm',
    onClick: () => onRenew(addMonths(current || todayISO(), months), months),
  }, `+${months} شهر`);
}

function openCustomRenew(current, onRenew) {
  const dateInput = input({ type: 'date', value: current || todayISO() });
  const m = modal({
    title: 'تجديد بتاريخ مخصص',
    body: el('div', { class: 'form-grid' }, [
      field('تاريخ الانتهاء الجديد', dateInput),
    ]),
    actions: [
      el('button', { type: 'button', class: 'btn-ghost', onClick: () => m.close() }, 'إلغاء'),
      el('button', { type: 'button', class: 'btn', onClick: () => {
        if (!dateInput.value) { toast('اختر تاريخاً', 'error'); return; }
        onRenew(dateInput.value, '?');
        m.close();
      } }, 'حفظ'),
    ],
  });
}
