import { store, uid } from './store.js';

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function register({ estName, ownerName, ownerEmail, password }) {
  if (!estName || !ownerEmail || !password) {
    throw new Error('الرجاء تعبئة جميع الحقول المطلوبة');
  }
  const existing = store.getEstablishmentByEmail(ownerEmail);
  if (existing) throw new Error('يوجد حساب مسجّل بهذا البريد بالفعل');
  const passwordHash = await sha256(password);
  const est = {
    id: uid('est'),
    name: estName,
    ownerName: ownerName || '',
    ownerEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  store.upsertEstablishment(est);
  store.setSession({ establishmentId: est.id, userEmail: ownerEmail });
  return est;
}

export async function login({ ownerEmail, password }) {
  const est = store.getEstablishmentByEmail(ownerEmail || '');
  if (!est) throw new Error('بيانات الدخول غير صحيحة');
  const hash = await sha256(password);
  if (hash !== est.passwordHash) throw new Error('بيانات الدخول غير صحيحة');
  store.setSession({ establishmentId: est.id, userEmail: ownerEmail });
  return est;
}

export function logout() {
  store.clearSession();
}

export function isAuthed() {
  return !!store.currentEstId();
}
