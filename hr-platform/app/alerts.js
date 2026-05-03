import { store } from './store.js';
import { daysUntil, severityFor } from './ui.js';

export const KIND_LABELS = {
  registration: 'سجل تجاري',
  license: 'ترخيص',
  iqama: 'إقامة',
  contract: 'عقد عمل',
};

export function computeAlerts() {
  const groups = {
    registration: [],
    license: [],
    iqama: [],
    contract: [],
  };

  store.list('registrations').forEach((r) => {
    groups.registration.push(makeItem({
      kind: 'registration', refId: r.id,
      title: r.type === 'commercial' ? 'سجل تجاري' : 'عضوية غرفة',
      subtitle: 'رقم: ' + (r.number || '—'),
      expiry: r.expiryDate, link: `#/registrations/${r.id}`,
    }));
  });

  store.list('licenses').forEach((l) => {
    groups.license.push(makeItem({
      kind: 'license', refId: l.id,
      title: licenseTypeLabel(l.type) + ' — ' + (l.authority || ''),
      subtitle: 'رقم: ' + (l.number || '—'),
      expiry: l.expiryDate, link: `#/licenses/${l.id}`,
    }));
  });

  store.list('employees').forEach((e) => {
    if (e.iqamaExpiry) {
      groups.iqama.push(makeItem({
        kind: 'iqama', refId: e.id,
        title: e.fullName,
        subtitle: 'رقم الإقامة: ' + (e.iqamaNumber || '—'),
        expiry: e.iqamaExpiry, link: `#/employees/${e.id}`,
      }));
    }
    if (e.contractEnd) {
      groups.contract.push(makeItem({
        kind: 'contract', refId: e.id,
        title: e.fullName,
        subtitle: e.jobTitle || '',
        expiry: e.contractEnd, link: `#/employees/${e.id}`,
      }));
    }
  });

  // sort each by days ascending (most urgent first)
  Object.values(groups).forEach((arr) =>
    arr.sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999))
  );

  return groups;
}

function makeItem({ kind, refId, title, subtitle, expiry, link }) {
  const daysLeft = daysUntil(expiry);
  return {
    kind, refId, title, subtitle, expiry, link,
    daysLeft, severity: severityFor(daysLeft),
  };
}

function licenseTypeLabel(t) {
  return ({
    municipal: 'بلدي',
    civil_defense: 'دفاع مدني',
    other: 'ترخيص',
  })[t] || 'ترخيص';
}

export function summaryStats() {
  const all = computeAlerts();
  const counts = { expired: 0, urgent: 0, soon: 0, ok: 0 };
  Object.values(all).forEach((arr) => {
    arr.forEach((it) => { counts[it.severity] = (counts[it.severity] || 0) + 1; });
  });
  return {
    counts,
    totals: {
      branches: store.list('branches').length,
      employees: store.list('employees').length,
      licenses: store.list('licenses').length,
      registrations: store.list('registrations').length,
    },
  };
}

export function flatAlerts() {
  const groups = computeAlerts();
  return Object.values(groups).flat()
    .sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999));
}
