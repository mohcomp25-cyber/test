import { createHmac, randomBytes } from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || 'change-me-in-production-' + randomBytes(16).toString('hex');
const COOKIE_NAME = 'admin_session';
const MAX_AGE = 60 * 60 * 8; // 8 hours

function sign(value) {
  return createHmac('sha256', SECRET).update(value).digest('hex');
}

export function createSession(adminId) {
  const payload = JSON.stringify({ id: adminId, exp: Date.now() + MAX_AGE * 1000 });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

export function readSession(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(/;\s*/).find(c => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const token = match.slice(COOKIE_NAME.length + 1);
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
