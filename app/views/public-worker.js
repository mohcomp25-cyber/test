import { el, field, input, toast } from '../ui.js';
import { verifyShareToken } from '../tokens.js';
import { store, uid } from '../store.js';

export async function renderPublicWorker(_ctx, app) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const token = params.get('t') || '';
  const payload = await verifyShareToken(token);

  const card = el('div', { class: 'card' }, []);
  const wrap = el('div', { class: 'public-page' }, [card]);
  app.appendChild(wrap);

  if (!payload || payload.kind !== 'worker') {
    card.appendChild(el('h1', {}, 'الرابط غير صالح'));
    card.appendChild(el('p', {}, 'الرابط منتهي أو ملغى. تواصل مع جهة العمل لإصدار رابط جديد.'));
    return;
  }

  const est = store.state.establishments[payload.estId];
  card.appendChild(el('h1', {}, 'تعبئة بياناتك'));
  card.appendChild(el('p', {}, [
    'مرحباً، الرجاء تعبئة بياناتك. سيتم إرسالها إلى ',
    el('strong', {}, est?.name || 'جهة العمل'),
    ' للمراجعة.',
  ]));

  const fullName = input({ required: '' });
  const nationality = input({});
  const iqamaNumber = input({});
  const iqamaExpiry = input({ type: 'date' });
  const phone = input({ type: 'tel' });
  const jobTitle = input({});
  const contractStart = input({ type: 'date' });
  const contractEnd = input({ type: 'date' });

  const form = el('form', {
    onSubmit: (e) => {
      e.preventDefault();
      if (!fullName.value.trim()) { toast('الاسم مطلوب', 'error'); return; }
      const data = {
        fullName: fullName.value.trim(),
        nationality: nationality.value.trim(),
        iqamaNumber: iqamaNumber.value.trim(),
        iqamaExpiry: iqamaExpiry.value,
        phone: phone.value.trim(),
        jobTitle: jobTitle.value.trim(),
        contractStart: contractStart.value,
        contractEnd: contractEnd.value,
      };
      // Save locally on visitor's device (so HR can also access it from same device)
      store.addPendingSubmission({
        estId: payload.estId,
        kind: 'worker',
        token,
        payload: data,
        submittedAt: new Date().toISOString(),
      });
      // Generate a portable "submission code" so HR (on a different device) can import it
      const code = btoa(unescape(encodeURIComponent(JSON.stringify({
        estId: payload.estId,
        kind: 'worker',
        payload: data,
        submittedAt: new Date().toISOString(),
      })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      card.replaceChildren(
        el('h1', {}, 'تم استلام بياناتك ✓'),
        el('p', {}, 'شكراً لك! انسخ الكود التالي وأرسله لجهة العمل (مثلاً عبر واتساب) لتدمج بياناتك في النظام:'),
        el('div', { class: 'share-link' }, code),
        el('div', { class: 'form-actions' }, [
          el('button', { class: 'btn-secondary', onClick: async () => {
            try { await navigator.clipboard.writeText(code); toast('تم نسخ الكود', 'success'); }
            catch { toast('تعذر النسخ تلقائياً، انسخ يدوياً', 'error'); }
          } }, 'نسخ الكود'),
        ]),
      );
      window.scrollTo(0, 0);
    },
  }, [
    el('div', { class: 'form-grid' }, [
      field('الاسم الكامل', fullName),
      field('الجنسية', nationality),
      field('رقم الإقامة', iqamaNumber),
      field('انتهاء الإقامة', iqamaExpiry),
      field('الجوال', phone),
      field('الوظيفة', jobTitle),
      field('بداية العقد', contractStart),
      field('نهاية العقد', contractEnd),
    ]),
    el('div', { class: 'form-actions' }, [
      el('button', { type: 'submit', class: 'btn' }, 'إرسال البيانات'),
    ]),
  ]);
  card.appendChild(form);
}
