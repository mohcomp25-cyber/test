import { store, uid } from './store.js';
import { addMonths, todayISO } from './ui.js';

function addDays(iso, days) {
  const d = new Date((iso || todayISO()) + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ensureSeed() {
  if (Object.keys(store.state.establishments).length > 0) return false;
  // Don't auto-seed; user creates own. Helper available from register screen.
  return false;
}

export async function loadDemoData() {
  // Wipes session + creates a new demo establishment
  const estId = uid('est');
  const passwordHash = await sha256('demo123');
  const est = {
    id: estId,
    name: 'مؤسسة النموذج التجريبي',
    ownerName: 'تجريبي',
    ownerEmail: 'demo@example.com',
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  store.upsertEstablishment(est);
  store.setSession({ establishmentId: estId, userEmail: est.ownerEmail });

  // Branches
  const b1 = uid('br'), b2 = uid('br');
  store.upsert('branches', { id: b1, estId, name: 'الفرع الرئيسي - الرياض', city: 'الرياض', address: 'حي العليا', managerName: 'سامي', phone: '0501111111' });
  store.upsert('branches', { id: b2, estId, name: 'فرع جدة', city: 'جدة', address: 'حي الروضة', managerName: 'فهد', phone: '0502222222' });

  // Registrations
  store.upsert('registrations', {
    id: uid('reg'), estId, type: 'commercial',
    number: '1010012345', issueDate: '2020-03-01',
    expiryDate: addMonths(todayISO(), 4), attachments: [],
  });
  store.upsert('registrations', {
    id: uid('reg'), estId, type: 'chamber',
    number: 'CH-552211', issueDate: '2023-01-15',
    expiryDate: addMonths(todayISO(), -10), attachments: [],
  });

  // Licenses
  store.upsert('licenses', {
    id: uid('lic'), estId, branchId: b1, type: 'municipal', authority: 'أمانة الرياض',
    number: 'M-9988', issueDate: '2023-06-01',
    expiryDate: addMonths(todayISO(), 1), attachments: [],
  });
  store.upsert('licenses', {
    id: uid('lic'), estId, branchId: b2, type: 'civil_defense', authority: 'الدفاع المدني',
    number: 'CD-7741', issueDate: '2024-02-10',
    expiryDate: addMonths(todayISO(), 8), attachments: [],
  });

  // Employees
  store.upsert('employees', {
    id: uid('emp'), estId, branchId: b1,
    fullName: 'أحمد عبدالله', nationality: 'سعودي',
    iqamaNumber: '', iqamaExpiry: '',
    jobTitle: 'مدير', salary: '15000', phone: '0503333333',
    contractStart: '2022-01-01', contractEnd: addMonths(todayISO(), 5),
    contractType: 'محدد', attachments: [],
  });
  store.upsert('employees', {
    id: uid('emp'), estId, branchId: b1,
    fullName: 'سامي يوسف', nationality: 'مصري',
    iqamaNumber: '2234567890', iqamaExpiry: addMonths(todayISO(), -3),
    jobTitle: 'محاسب', salary: '5500', phone: '0504444444',
    contractStart: '2023-04-01', contractEnd: addMonths(todayISO(), 2),
    contractType: 'محدد', attachments: [],
  });
  store.upsert('employees', {
    id: uid('emp'), estId, branchId: b2,
    fullName: 'محمد كمال', nationality: 'بنغالي',
    iqamaNumber: '2987654321', iqamaExpiry: addDays(todayISO(), 12),
    jobTitle: 'فني', salary: '3500', phone: '0505555555',
    contractStart: '2024-01-15', contractEnd: addMonths(todayISO(), 11),
    contractType: 'محدد', attachments: [],
  });
  store.upsert('employees', {
    id: uid('emp'), estId, branchId: b2,
    fullName: 'راج كومار', nationality: 'هندي',
    iqamaNumber: '2876543210', iqamaExpiry: addMonths(todayISO(), 8),
    jobTitle: 'سائق', salary: '3000', phone: '0506666666',
    contractStart: '2024-06-01', contractEnd: addMonths(todayISO(), 18),
    contractType: 'محدد', attachments: [],
  });

  return est;
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
