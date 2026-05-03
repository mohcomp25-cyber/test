const KEY = 'hr_platform.v1';

const empty = () => ({
  establishments: {},
  session: null,
  branches: [],
  registrations: [],
  licenses: [],
  employees: [],
  pendingSubmissions: [],
  activityLog: [],
  shareTokens: {},
});

let state = load();
const subscribers = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

function persist() {
  localStorage.setItem(KEY, JSON.stringify(state));
  subscribers.forEach((fn) => {
    try { fn(state); } catch (e) { console.error(e); }
  });
}

export const store = {
  get state() { return state; },

  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  reset() { state = empty(); persist(); },

  setSession(session) {
    state.session = session;
    persist();
  },
  clearSession() {
    state.session = null;
    persist();
  },

  currentEstId() { return state.session?.establishmentId || null; },
  currentEst() {
    const id = state.session?.establishmentId;
    return id ? state.establishments[id] : null;
  },

  upsertEstablishment(est) {
    state.establishments[est.id] = est;
    persist();
  },
  getEstablishmentByEmail(email) {
    return Object.values(state.establishments).find(
      (e) => e.ownerEmail.toLowerCase() === email.toLowerCase()
    );
  },

  list(collection, filterCurrent = true) {
    const all = state[collection] || [];
    if (!filterCurrent) return all;
    const estId = this.currentEstId();
    if (!estId) return [];
    return all.filter((x) => x.estId === estId);
  },

  get(collection, id) {
    const item = (state[collection] || []).find((x) => x.id === id);
    if (!item) return null;
    const estId = this.currentEstId();
    if (estId && item.estId && item.estId !== estId) return null;
    return item;
  },

  upsert(collection, item) {
    if (!state[collection]) state[collection] = [];
    const idx = state[collection].findIndex((x) => x.id === item.id);
    if (idx >= 0) state[collection][idx] = item;
    else state[collection].push(item);
    persist();
    return item;
  },

  remove(collection, id) {
    if (!state[collection]) return;
    state[collection] = state[collection].filter((x) => x.id !== id);
    persist();
  },

  appendActivity(entry) {
    state.activityLog.unshift({
      id: uid(),
      ts: new Date().toISOString(),
      ...entry,
    });
    if (state.activityLog.length > 500) state.activityLog.length = 500;
    persist();
  },

  // share tokens stored by token id (not by establishment)
  putShareToken(tokenId, info) {
    state.shareTokens[tokenId] = info;
    persist();
  },
  getShareToken(tokenId) { return state.shareTokens[tokenId]; },

  addPendingSubmission(sub) {
    state.pendingSubmissions.unshift({ id: uid(), ...sub });
    persist();
  },
  removePendingSubmission(id) {
    state.pendingSubmissions = state.pendingSubmissions.filter((s) => s.id !== id);
    persist();
  },

  exportAll() { return JSON.parse(JSON.stringify(state)); },
  importAll(snapshot) {
    state = { ...empty(), ...snapshot };
    persist();
  },
};

export function uid(prefix = '') {
  return (prefix ? prefix + '_' : '') +
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
