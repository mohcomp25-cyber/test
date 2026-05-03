import { el, field, input, toast } from '../ui.js';
import { verifyShareToken } from '../tokens.js';
import { store } from '../store.js';

export async function renderPublicHR(_ctx, app) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const token = params.get('t') || '';
  const payload = await verifyShareToken(token);

  const card = el('div', { class: 'card' }, []);
  const wrap = el('div', { class: 'public-page' }, [card]);
  app.appendChild(wrap);

  if (!payload || payload.kind !== 'hr') {
    card.appendChild(el('h1', {}, 'الرابط غير صالح'));
    card.appendChild(el('p', {}, 'الرابط منتهي أو ملغى.'));
    return;
  }

  const est = store.state.establishments[payload.estId];

  const rowsHost = el('div', {});
  const rows = [];

  function addRow(initial = {}) {
    const r = {
      fullName: input({ value: initial.fullName || '' }),
      nationality: input({ value: initial.nationality || '' }),
      iqamaNumber: input({ value: initial.iqamaNumber || '' }),
      iqamaExpiry: input({ type: 'date', value: initial.iqamaExpiry || '' }),
      phone: input({ value: initial.phone || '', type: 'tel' }),
      jobTitle: input({ value: initial.jobTitle || '' }),
    };
    const node = el('div', { class: 'card', style: { marginTop: '10px' } }, [
      el('div', { class: 'form-grid' }, [
        field('الاسم الكامل', r.fullName),
        field('الجنسية', r.nationality),
        field('رقم الإقامة', r.iqamaNumber),
        field('انتهاء الإقامة', r.iqamaExpiry),
        field('الجوال', r.phone),
        field('الوظيفة', r.jobTitle),
      ]),
      el('div', { class: 'form-actions' }, [
        el('button', { type: 'button', class: 'btn-danger btn-sm', onClick: () => {
          rows.splice(rows.indexOf(entry), 1);
          node.remove();
        } }, 'حذف هذا الصف'),
      ]),
    ]);
    const entry = { node, fields: r };
    rows.push(entry);
    rowsHost.appendChild(node);
  }
  addRow();

  card.appendChild(el('h1', {}, 'إدخال دفعة بيانات'));
  card.appendChild(el('p', {}, [
    'لـ ',
    el('strong', {}, est?.name || 'جهة العمل'),
    '. يمكنك إضافة عدة عمال في نفس الجلسة.',
  ]));

  card.appendChild(rowsHost);

  card.appendChild(el('div', { class: 'form-actions between' }, [
    el('button', { class: 'btn-secondary', onClick: () => addRow() }, '+ إضافة صف'),
    el('button', { class: 'btn', onClick: submit }, 'إرسال الدفعة'),
  ]));

  function submit() {
    const data = rows.map((r) => ({
      fullName: r.fields.fullName.value.trim(),
      nationality: r.fields.nationality.value.trim(),
      iqamaNumber: r.fields.iqamaNumber.value.trim(),
      iqamaExpiry: r.fields.iqamaExpiry.value,
      phone: r.fields.phone.value.trim(),
      jobTitle: r.fields.jobTitle.value.trim(),
    })).filter((d) => d.fullName);

    if (!data.length) { toast('الرجاء إدخال بيانات عامل واحد على الأقل', 'error'); return; }

    store.addPendingSubmission({
      estId: payload.estId,
      kind: 'hr-batch',
      token,
      payload: data,
      submittedAt: new Date().toISOString(),
    });

    const code = btoa(unescape(encodeURIComponent(JSON.stringify({
      estId: payload.estId,
      kind: 'hr-batch',
      payload: data,
      submittedAt: new Date().toISOString(),
    })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    card.replaceChildren(
      el('h1', {}, 'تم استلام الدفعة ✓'),
      el('p', {}, `تم تسجيل ${data.length} عامل. أرسل الكود التالي لمسؤول النظام لدمجه:`),
      el('div', { class: 'share-link' }, code),
      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn-secondary', onClick: async () => {
          try { await navigator.clipboard.writeText(code); toast('تم نسخ الكود', 'success'); }
          catch { toast('تعذر النسخ', 'error'); }
        } }, 'نسخ الكود'),
      ]),
    );
    window.scrollTo(0, 0);
  }
}
