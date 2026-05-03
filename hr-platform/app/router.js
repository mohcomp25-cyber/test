const routes = [];
let currentParams = {};
let onChange = null;

export function defineRoutes(list, opts = {}) {
  routes.length = 0;
  list.forEach((r) => routes.push(compile(r)));
  onChange = opts.onChange || null;
}

function compile({ pattern, view, public: isPublic }) {
  // pattern like '#/employees/:id'
  const parts = pattern.replace(/^#?\/?/, '').split('/').filter(Boolean);
  const keys = [];
  const regexParts = parts.map((p) => {
    if (p.startsWith(':')) { keys.push(p.slice(1)); return '([^/]+)'; }
    return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const regex = new RegExp('^' + (regexParts.join('/') || '') + '$');
  return { pattern, regex, keys, view, public: !!isPublic };
}

export function navigate(to) {
  if (location.hash === to) {
    handleRoute();
  } else {
    location.hash = to;
  }
}

export function currentHash() {
  return location.hash || '#/';
}

export function getQuery() {
  const h = currentHash();
  const qIdx = h.indexOf('?');
  if (qIdx === -1) return {};
  const search = h.slice(qIdx + 1);
  return Object.fromEntries(new URLSearchParams(search));
}

export function getParams() { return currentParams; }

export function handleRoute() {
  const h = currentHash();
  const noQuery = h.split('?')[0];
  const path = noQuery.replace(/^#?\/?/, '').replace(/\/$/, '');
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      currentParams = {};
      r.keys.forEach((k, i) => (currentParams[k] = decodeURIComponent(m[i + 1])));
      if (onChange) onChange(r);
      return r.view({ params: currentParams, query: getQuery() });
    }
  }
  // fallback
  const fallback = routes.find((r) => r.pattern === '#/' || r.pattern === '#/dashboard');
  if (fallback) fallback.view({ params: {}, query: {} });
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
