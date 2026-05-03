import { defineRoutes, startRouter, navigate, currentHash } from './router.js';
import { store } from './store.js';
import { isAuthed, logout } from './auth.js';
import { setPageTitle, clear, toast } from './ui.js';

import { renderLogin } from './views/login.js';
import { renderRegister } from './views/register.js';
import { renderDashboard } from './views/dashboard.js';
import { renderBranches, renderBranchDetail } from './views/branches.js';
import { renderRegistrations, renderRegistrationDetail } from './views/registrations.js';
import { renderLicenses, renderLicenseDetail } from './views/licenses.js';
import { renderEmployees } from './views/employees.js';
import { renderEmployeeDetail } from './views/employee-detail.js';
import { renderImport } from './views/import.js';
import { renderShareLinks } from './views/share-links.js';
import { renderNotifications } from './views/notifications-view.js';
import { renderPublicWorker } from './views/public-worker.js';
import { renderPublicHR } from './views/public-hr.js';

const ROUTES = [
  { pattern: '#/login', view: guardPublic(renderLogin), public: true },
  { pattern: '#/register', view: guardPublic(renderRegister), public: true },
  { pattern: '#/p/worker', view: shellPublic(renderPublicWorker), public: true },
  { pattern: '#/p/hr', view: shellPublic(renderPublicHR), public: true },

  { pattern: '#/', view: guardAuthed(renderDashboard, 'الرئيسية', 'dashboard') },
  { pattern: '#/dashboard', view: guardAuthed(renderDashboard, 'الرئيسية', 'dashboard') },
  { pattern: '#/branches', view: guardAuthed(renderBranches, 'الفروع', 'branches') },
  { pattern: '#/branches/:id', view: guardAuthed(renderBranchDetail, 'الفروع', 'branches') },
  { pattern: '#/registrations', view: guardAuthed(renderRegistrations, 'السجلات', 'registrations') },
  { pattern: '#/registrations/:id', view: guardAuthed(renderRegistrationDetail, 'السجلات', 'registrations') },
  { pattern: '#/licenses', view: guardAuthed(renderLicenses, 'التراخيص', 'licenses') },
  { pattern: '#/licenses/:id', view: guardAuthed(renderLicenseDetail, 'التراخيص', 'licenses') },
  { pattern: '#/employees', view: guardAuthed(renderEmployees, 'العمالة', 'employees') },
  { pattern: '#/employees/:id', view: guardAuthed(renderEmployeeDetail, 'العمالة', 'employees') },
  { pattern: '#/import', view: guardAuthed(renderImport, 'استيراد Excel', 'import') },
  { pattern: '#/share', view: guardAuthed(renderShareLinks, 'الروابط الخارجية', 'share') },
  { pattern: '#/notifications', view: guardAuthed(renderNotifications, 'سجل الإشعارات', 'notifications') },
];

function guardAuthed(viewFn, title, navKey) {
  return (ctx) => {
    if (!isAuthed()) { navigate('#/login'); return; }
    ensureShell();
    setPageTitle(title);
    setActiveNav(navKey);
    refreshUserChip();
    viewFn(ctx);
  };
}

function guardPublic(viewFn) {
  return (ctx) => {
    if (isAuthed()) { navigate('#/dashboard'); return; }
    renderAuthShell(viewFn, ctx);
  };
}

function shellPublic(viewFn) {
  return (ctx) => renderPublicShell(viewFn, ctx);
}

function renderAuthShell(viewFn, ctx) {
  const app = document.getElementById('app');
  app.dataset.state = 'auth';
  clear(app);
  viewFn(ctx, app);
}

function renderPublicShell(viewFn, ctx) {
  const app = document.getElementById('app');
  app.dataset.state = 'public';
  clear(app);
  viewFn(ctx, app);
}

function ensureShell() {
  const app = document.getElementById('app');
  if (app.dataset.state !== 'shell') {
    app.dataset.state = 'shell';
    app.classList.remove('menu-open');
    clear(app);
    const tpl = document.getElementById('tpl-shell');
    app.appendChild(tpl.content.cloneNode(true));
    bindShell(app);
  }
}

function bindShell(app) {
  app.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout') {
      logout();
      toast('تم تسجيل الخروج');
      navigate('#/login');
    } else if (action === 'toggle-sidebar') {
      app.classList.toggle('menu-open');
    } else if (e.target.closest('.nav a')) {
      app.classList.remove('menu-open');
    }
  });
}

function setActiveNav(key) {
  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === key);
  });
}

function refreshUserChip() {
  const est = store.currentEst();
  const chip = document.querySelector('[data-user-chip]');
  const sub = document.querySelector('[data-est-name]');
  if (chip) chip.textContent = est ? est.ownerEmail : '—';
  if (sub) sub.textContent = est ? est.name : '—';
}

defineRoutes(ROUTES);

// Re-render on store changes if user is on a data-driven view (avoid disrupting forms)
store.subscribe(() => {
  // refresh shell chip if shell is visible
  if (document.getElementById('app').dataset.state === 'shell') refreshUserChip();
});

startRouter();

// On initial load: redirect to login if needed
window.addEventListener('load', () => {
  const h = currentHash();
  if (h === '#/' || h === '' || h === '#') {
    if (!isAuthed()) navigate('#/login');
  }
});
