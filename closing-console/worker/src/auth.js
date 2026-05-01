// Auth primitives: PBKDF2 password hashing + HS256 JWT (WebCrypto).

const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ITERS = 100_000;
const PBKDF2_LEN = 32;

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pbkdf2(password, salt, iterations = PBKDF2_ITERS, len = PBKDF2_LEN) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, len * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(plain, pepper = "") {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await pbkdf2(plain + pepper, salt);
  return `pbkdf2$${PBKDF2_ITERS}$${b64urlEncode(salt)}$${b64urlEncode(derived)}`;
}

export async function verifyPassword(plain, stored, pepper = "") {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = Number(parts[1]);
  const salt = b64urlDecode(parts[2]);
  const expected = b64urlDecode(parts[3]);
  const derived = await pbkdf2(plain + pepper, salt, iters, expected.length);
  return timingSafeEqual(expected, derived);
}

export async function hashPin(pin, pepper = "") {
  const salt = new Uint8Array(12);
  crypto.getRandomValues(salt);
  const derived = await pbkdf2(pin + pepper, salt, 50_000, 24);
  return `pbkdf2$50000$${b64urlEncode(salt)}$${b64urlEncode(derived)}`;
}

export async function verifyPin(pin, stored, pepper = "") {
  return verifyPassword(pin, stored, pepper);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlEncode(enc.encode(JSON.stringify(header)));
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const data = `${h}.${p}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyJwt(token, secret) {
  if (!token || token.split(".").length !== 3) return null;
  const [h, p, s] = token.split(".");
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(s), enc.encode(`${h}.${p}`));
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(dec.decode(b64urlDecode(p))); } catch { return null; }
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

const COOKIE = "dcc_session";

export function readCookie(req, name = COOKIE) {
  const raw = req.headers.get("cookie") || "";
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i > 0 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1));
  }
  return null;
}

export function setCookieHeader(value, { maxAge = 60 * 60 * 8, secure = true } = {}) {
  const flags = ["HttpOnly", "Path=/", `Max-Age=${maxAge}`, "SameSite=Lax"];
  if (secure) flags.push("Secure");
  return `${COOKIE}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
}

export function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

export async function requireAccountant(req, env) {
  const tok = readCookie(req);
  if (!tok) return null;
  const claims = await verifyJwt(tok, env.JWT_SECRET);
  if (!claims || claims.typ !== "accountant") return null;
  return { id: claims.sub, email: claims.eml, name: claims.nm };
}
