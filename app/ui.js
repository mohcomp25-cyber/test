// DOM helpers + formatting

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  if (children == null || children === false) return;
  if (Array.isArray(children)) {
    children.forEach((c) => appendChildren(node, c));
    return;
  }
  if (children instanceof Node) { node.appendChild(children); return; }
  node.appendChild(document.createTextNode(String(children)));
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setView(content) {
  const view = document.getElementById('view');
  if (!view) return;
  clear(view);
  appendChildren(view, content);
  view.scrollTop = 0;
}

export function setPageTitle(title) {
  const elTitle = document.querySelector('[data-page-title]');
  if (elTitle) elTitle.textContent = title;
  document.title = title + ' — منصة الموارد البشرية';
}

export function toast(message, type = 'info') {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = el('div', { class: 'toast-host' });
    document.body.appendChild(host);
  }
  const t = el('div', { class: `toast ${type}` }, message);
  host.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .3s';
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

export function modal({ title, body, actions, onClose } = {}) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.remove();
    if (onClose) onClose();
  };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const dialog = el('div', { class: 'modal' }, [
    title ? el('h3', {}, title) : null,
    body,
    actions ? el('div', { class: 'form-actions' }, actions) : null,
  ]);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  return { close, backdrop, dialog };
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const m = modal({
      title: 'تأكيد',
      body: el('p', {}, message),
      actions: [
        el('button', { class: 'btn-ghost', type: 'button', onClick: () => { m.close(); resolve(false); } }, 'إلغاء'),
        el('button', { class: 'btn-danger', type: 'button', onClick: () => { m.close(); resolve(true); } }, 'تأكيد'),
      ],
      onClose: () => resolve(false),
    });
  });
}

// === Date helpers ===
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(d);
  } catch {
    return iso;
  }
}

export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

export function addMonths(iso, months) {
  if (!iso) iso = todayISO();
  const d = new Date(iso + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function severityFor(daysLeft) {
  if (daysLeft == null) return 'muted';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'urgent';
  if (daysLeft <= 90) return 'soon';
  return 'ok';
}

export function severityPill(daysLeft) {
  const sev = severityFor(daysLeft);
  if (sev === 'expired') return el('span', { class: 'pill pill-danger' }, `منتهية منذ ${Math.abs(daysLeft)} يوم`);
  if (sev === 'urgent')  return el('span', { class: 'pill pill-warning' }, `متبقي ${daysLeft} يوم`);
  if (sev === 'soon')    return el('span', { class: 'pill pill-info' }, `متبقي ${daysLeft} يوم`);
  if (sev === 'ok')      return el('span', { class: 'pill pill-success' }, `متبقي ${daysLeft} يوم`);
  return el('span', { class: 'pill pill-muted' }, '—');
}

export function field(labelText, control, hint) {
  return el('div', { class: 'field' }, [
    el('label', {}, labelText),
    control,
    hint ? el('span', { class: 'hint' }, hint) : null,
  ]);
}

export function input(attrs = {}) {
  return el('input', { type: 'text', ...attrs });
}

export function select(options, attrs = {}) {
  const sel = el('select', attrs);
  options.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (attrs.value === o.value) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

export function pageHeader(title, actions) {
  return el('div', { class: 'section-head' }, [
    el('h2', {}, title),
    actions ? el('div', { class: 'btn-row' }, actions) : null,
  ]);
}
