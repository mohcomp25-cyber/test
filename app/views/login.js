import { el, field, input, toast } from '../ui.js';
import { login } from '../auth.js';
import { navigate } from '../router.js';
import { loadDemoData } from '../seed.js';

export function renderLogin(_ctx, app) {
  const emailInput = input({ type: 'email', placeholder: 'owner@example.com', required: '', autocomplete: 'email' });
  const pwInput = input({ type: 'password', placeholder: '••••••••', required: '', autocomplete: 'current-password' });

  const form = el('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      try {
        await login({ ownerEmail: emailInput.value.trim(), password: pwInput.value });
        toast('تم تسجيل الدخول', 'success');
        navigate('#/dashboard');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  }, [
    el('div', { class: 'form-grid' }, [
      field('البريد الإلكتروني', emailInput),
      field('كلمة المرور', pwInput),
    ]),
    el('div', { class: 'form-actions between' }, [
      el('button', { type: 'button', class: 'btn-ghost', onClick: async () => {
        try {
          await loadDemoData();
          toast('تم تحميل البيانات التجريبية', 'success');
          navigate('#/dashboard');
        } catch (err) { toast(err.message, 'error'); }
      } }, 'بيانات تجريبية'),
      el('button', { type: 'submit', class: 'btn' }, 'دخول'),
    ]),
  ]);

  const card = el('div', { class: 'auth-card' }, [
    el('h1', {}, 'منصة الموارد البشرية'),
    el('p', {}, 'سجّل دخول حساب المنشأة لإدارة الفروع والعمالة والوثائق.'),
    form,
    el('div', { class: 'auth-switch' }, [
      'ليس لديك حساب؟ ',
      el('a', { href: '#/register' }, 'إنشاء حساب جديد'),
    ]),
  ]);

  app.appendChild(card);
}
