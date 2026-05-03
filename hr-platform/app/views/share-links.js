import { el, setView, pageHeader, toast, field, input, select, formatDate, modal, confirmDialog } from '../ui.js';
import { createShareToken, listEstablishmentTokens, revokeShareToken, publicLinkFor } from '../tokens.js';
import { store } from '../store.js';
import QRCode from 'qrcode';

export function renderShareLinks() {
  const labelInput = input({ placeholder: 'مثال: روابط دفعة جوازات نوفمبر' });
  const kindSel = select([
    { value: 'worker', label: 'رابط للعامل (يعبئ بياناته بنفسه)' },
    { value: 'hr', label: 'رابط لـ HR ميداني (إدخال متعدد)' },
  ], {});
  const expiryInput = input({ type: 'number', value: '30', min: '1', max: '365' });

  setView([
    pageHeader('الروابط الخارجية'),
    el('div', { class: 'card' }, [
      el('h3', { style: { marginTop: 0 } }, 'إنشاء رابط جديد'),
      el('p', { class: 'hint' }, 'الروابط مؤقتة وموقّعة. ينصح بإلغاء الرابط بعد استلام البيانات.'),
      el('div', { class: 'form-grid' }, [
        field('نوع الرابط', kindSel),
        field('مدة الصلاحية (أيام)', expiryInput),
        field('وصف للرابط (اختياري)', labelInput),
      ]),
      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn', onClick: async () => {
          const days = parseInt(expiryInput.value, 10) || 30;
          const token = await createShareToken({
            kind: kindSel.value,
            expiresInDays: days,
            label: labelInput.value.trim(),
          });
          const link = publicLinkFor(token, kindSel.value);
          showLinkDialog(link, kindSel.options[kindSel.selectedIndex].textContent);
          renderShareLinks();
        } }, 'إنشاء رابط'),
      ]),
    ]),
    pendingSubmissionsCard(),
    tokenListCard(),
  ]);
}

function showLinkDialog(link, kindLabel) {
  const qrCanvas = el('canvas', {});
  QRCode.toCanvas(qrCanvas, link, { width: 220, margin: 1 }, (err) => {
    if (err) console.error(err);
  });

  const m = modal({
    title: 'تم إنشاء الرابط',
    body: el('div', {}, [
      el('p', {}, kindLabel + ':'),
      el('div', { class: 'qr-box' }, qrCanvas),
      el('p', { class: 'hint' }, 'امسح الرمز بالجوال أو انسخ الرابط:'),
      el('div', { class: 'share-link' }, link),
      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn-secondary', onClick: async () => {
          try { await navigator.clipboard.writeText(link); toast('تم النسخ', 'success'); }
          catch { toast('تعذر النسخ تلقائياً', 'error'); }
        } }, 'نسخ الرابط'),
      ]),
    ]),
    actions: [
      el('button', { class: 'btn', onClick: () => m.close() }, 'تم'),
    ],
  });
}

function tokenListCard() {
  const tokens = listEstablishmentTokens();
  return el('div', { class: 'card', style: { marginTop: '14px' } }, [
    el('h3', { style: { marginTop: 0 } }, 'الروابط النشطة'),
    tokens.length === 0
      ? el('p', { class: 'hint' }, 'لا توجد روابط بعد.')
      : el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'النوع'),
          el('th', {}, 'الوصف'),
          el('th', {}, 'تاريخ الإنشاء'),
          el('th', {}, 'الانتهاء'),
          el('th', {}, 'الحالة'),
          el('th', {}, 'إجراء'),
        ])),
        el('tbody', {}, tokens.map((t) => el('tr', {}, [
          el('td', {}, t.kind === 'worker' ? 'عامل' : 'HR'),
          el('td', {}, t.label || '—'),
          el('td', {}, formatDate(t.createdAt)),
          el('td', {}, formatDate(t.expiresAt)),
          el('td', {}, t.revoked ? el('span', { class: 'pill pill-danger' }, 'ملغى') : el('span', { class: 'pill pill-success' }, 'نشط')),
          el('td', {}, t.revoked ? '—' : el('button', { class: 'btn-danger btn-sm', onClick: async () => {
            if (await confirmDialog('إلغاء هذا الرابط؟ لن يستطيع المستلم تعبئته بعد ذلك.')) {
              revokeShareToken(t.tid);
              toast('تم الإلغاء', 'success');
              renderShareLinks();
            }
          } }, 'إلغاء')),
        ]))),
      ])),
  ]);
}

function pendingSubmissionsCard() {
  const subs = store.list('pendingSubmissions');
  const codeInput = el('textarea', { rows: '3', placeholder: 'الصق هنا كود الإرسال الذي وصلك من العامل أو من الميدان...' });
  return el('div', { class: 'card', style: { marginTop: '14px' } }, [
    el('h3', { style: { marginTop: 0 } }, 'طلبات معلقة بانتظار المراجعة'),
    el('div', { class: 'field', style: { marginBottom: '12px' } }, [
      el('label', {}, 'استلام كود إرسال (من جهاز آخر)'),
      codeInput,
      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn-secondary btn-sm', onClick: () => importSubmissionCode(codeInput.value.trim()) }, 'استيراد الكود'),
      ]),
    ]),
    subs.length === 0
      ? el('p', { class: 'hint' }, 'لا توجد طلبات معلقة. عند تعبئة العامل أو موظف HR للنموذج الخارجي، ستظهر الطلبات هنا للمراجعة.')
      : el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'النوع'),
          el('th', {}, 'الاسم/البيانات'),
          el('th', {}, 'وقت الإرسال'),
          el('th', {}, 'إجراءات'),
        ])),
        el('tbody', {}, subs.map((s) => el('tr', {}, [
          el('td', {}, s.kind === 'worker' ? 'عامل' : 'دفعة HR'),
          el('td', {}, summarizePayload(s)),
          el('td', {}, formatDate(s.submittedAt)),
          el('td', {}, el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn btn-sm', onClick: () => approveSubmission(s) }, 'قبول ودمج'),
            el('button', { class: 'btn-danger btn-sm', onClick: async () => {
              if (await confirmDialog('رفض وحذف هذا الطلب؟')) {
                store.removePendingSubmission(s.id);
                renderShareLinks();
              }
            } }, 'رفض'),
          ])),
        ]))),
      ])),
  ]);
}

function importSubmissionCode(code) {
  if (!code) { toast('الصق الكود أولاً', 'error'); return; }
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - code.length % 4) % 4);
    const json = decodeURIComponent(escape(atob(padded)));
    const data = JSON.parse(json);
    if (!data.estId || !data.kind || !data.payload) throw new Error('كود غير صالح');
    if (data.estId !== store.currentEstId()) {
      toast('الكود ليس لهذه المنشأة', 'error');
      return;
    }
    store.addPendingSubmission({
      estId: data.estId,
      kind: data.kind,
      token: 'imported-code',
      payload: data.payload,
      submittedAt: data.submittedAt || new Date().toISOString(),
    });
    toast('تم استيراد الطلب، يمكنك مراجعته الآن', 'success');
    renderShareLinks();
  } catch (err) {
    toast('تعذر قراءة الكود: تأكد من صحته', 'error');
  }
}

function summarizePayload(s) {
  if (s.kind === 'worker') {
    return s.payload?.fullName || '—';
  }
  return `${s.payload?.length || 0} عامل`;
}

function approveSubmission(s) {
  const estId = store.currentEstId();
  if (s.kind === 'worker') {
    const p = s.payload || {};
    store.upsert('employees', {
      id: 'emp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      estId,
      branchId: null,
      fullName: p.fullName || '',
      nationality: p.nationality || '',
      jobTitle: p.jobTitle || '',
      salary: '',
      phone: p.phone || '',
      iqamaNumber: p.iqamaNumber || '',
      iqamaExpiry: p.iqamaExpiry || '',
      contractStart: p.contractStart || '',
      contractEnd: p.contractEnd || '',
      contractType: '',
      attachments: [],
      createdAt: new Date().toISOString(),
    });
  } else if (s.kind === 'hr-batch') {
    (s.payload || []).forEach((p) => {
      store.upsert('employees', {
        id: 'emp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        estId,
        branchId: null,
        fullName: p.fullName || '',
        nationality: p.nationality || '',
        jobTitle: p.jobTitle || '',
        salary: '',
        phone: p.phone || '',
        iqamaNumber: p.iqamaNumber || '',
        iqamaExpiry: p.iqamaExpiry || '',
        contractStart: '',
        contractEnd: '',
        contractType: '',
        attachments: [],
        createdAt: new Date().toISOString(),
      });
    });
  }
  store.removePendingSubmission(s.id);
  toast('تم القبول والدمج', 'success');
  renderShareLinks();
}
