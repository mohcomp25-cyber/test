// Shared route helpers.

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}

export function err(status, code, extra = {}) {
  return json({ error: code, ...extra }, { status });
}

export function getIp(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
}

export function getUA(req) {
  return req.headers.get("user-agent") || "";
}

export async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

export function csrfOk(req, method) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  return req.headers.get("x-dcc-csrf") === "1";
}

export function intOr(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export function methodMatch(req, ...methods) {
  return methods.includes(req.method);
}
