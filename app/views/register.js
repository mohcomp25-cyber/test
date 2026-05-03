import { el, field, input, toast } from '../ui.js';
import { register } from '../auth.js';
import { navigate } from '../router.js';

export function renderRegister(_ctx, app) {
  const estInput = input({ placeholder: 'مثلاً: مؤسسة المستقبل التجارية', required: '' });
  const nameInput = input({ placeholder: 'اسم المسؤول' });
  const emailInput = input({ type: 'email', placeholder: 'owner@example.com', required: '' });
  const pwInput = input({ type: 'password', minlength: '6', required: '' });

  const form = el('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      try {
        await register({
          estName: estInput.value.trim(),
          ownerName: nameInput.value.trim(),
          ownerEmail: emailInput.value.trim(),
          password: pwInput.value,
        });
        toast('تم إنشاء الحساب', 'success');
        navigate('#/dashboard');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  }, [
    el('div', { class: 'form-grid' }, [
      field('اسم المنشأة', estInput),
      field('اسم المسؤول', nameInput),
      field('البريد الإلكتروني', emailInput),
      field('كلمة المرور', pwInput, '٦ أحرف على الأقل'),
    ]),
    el('div', { class: 'form-actions' }, [
      el('button', { type: 'submit', class: 'btn' }, 'إنشاء الحساب'),
    ]),
  ]);

  const card = el('div', { class: 'auth-card' }, [
    el('h1', {}, 'تسجيل منشأة جديدة'),
    el('p', {}, 'أنشئ حساب منشأتك لتبدأ إدارة بيانات العمالة والوثائق.'),
    form,
    el('div', { class: 'auth-switch' }, [
      'لديك حساب؟ ',
      el('a', { href: '#/login' }, 'تسجيل الدخول'),
    ]),
  ]);
  app.appendChild(card);
}
