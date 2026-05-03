import { store, uid } from './store.js';

// Token format (PROTOTYPE only — NOT cryptographically secure):
// token = base64url(JSON({estId, kind, tid, exp}))
//
// Without a backend, we cannot verify a signature on a different device
// (the secret would have to be embedded in the URL). For production, this
// MUST be replaced with backend-issued JWTs or signed tokens.
//
// Revocation works via shareTokens metadata stored on the issuer's device.
// On a different device the visitor cannot see revocation status — once
// the platform has a backend, both signing AND revocation become reliable.

function base64url(bytes) {
  const bin = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function createShareToken({ kind, expiresInDays = 30, label = '' }) {
  const estId = store.currentEstId();
  if (!estId) throw new Error('No active session');
  const tid = uid('tok');
  const payload = {
    estId, kind, tid,
    exp: Date.now() + expiresInDays * 86400 * 1000,
  };
  const json = JSON.stringify(payload);
  const token = base64url(new TextEncoder().encode(json));
  store.putShareToken(tid, {
    estId, kind, label,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(payload.exp).toISOString(),
    revoked: false,
  });
  return token;
}

export async function verifyShareToken(token) {
  if (!token || typeof token !== 'string') return null;
  let payload;
  try {
    const json = new TextDecoder().decode(fromBase64url(token));
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload.estId || !payload.kind || !payload.tid) return null;
  if (payload.exp && payload.exp < Date.now()) return null;
  // Local revocation check (only effective on issuer's device — see header note)
  const meta = store.getShareToken(payload.tid);
  if (meta && meta.revoked) return null;
  return payload;
}

export function publicLinkFor(token, kind) {
  const base = location.origin + location.pathname;
  return `${base}#/p/${kind}?t=${encodeURIComponent(token)}`;
}

export function listEstablishmentTokens() {
  const estId = store.currentEstId();
  const all = store.state.shareTokens || {};
  return Object.entries(all)
    .filter(([, info]) => info.estId === estId)
    .map(([tid, info]) => ({ tid, ...info }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function revokeShareToken(tid) {
  const info = store.getShareToken(tid);
  if (!info) return;
  store.putShareToken(tid, { ...info, revoked: true });
}
