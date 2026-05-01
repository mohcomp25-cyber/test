// Console-side uploads (accountant). Used for deposit receipts.

import { requireAccountant } from "../auth.js";
import { json, err, readJson, csrfOk, getIp } from "./_util.js";
import { isAllowedType, maxBytes, putObject } from "../r2.js";
import { uuid } from "../ids.js";

export async function handleUploads(req, env) {
  const acc = await requireAccountant(req, env);
  if (!acc) return err(401, "unauthorized");
  if (!csrfOk(req, req.method)) return err(403, "csrf");
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/uploads/sign" && method === "POST") return signUpload(req, env, acc);
  if (path === "/api/uploads/put" && method === "PUT") return putUpload(req, env, acc);
  return err(404, "not_found");
}

async function signUpload(req, env, acc) {
  const body = await readJson(req) || {};
  const ct = String(body.content_type || "").toLowerCase();
  const size = +body.size_bytes || 0;
  if (!isAllowedType(ct)) return err(400, "bad_type");
  if (size <= 0 || size > maxBytes()) return err(400, "bad_size");
  const key = `uploads/console/${acc.id}/${uuid()}`;
  return json({ key, content_type: ct, max_bytes: maxBytes() });
}

async function putUpload(req, env, acc) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (!key.startsWith(`uploads/console/${acc.id}/`)) return err(400, "bad_key");
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!isAllowedType(ct)) return err(400, "bad_type");
  const len = +req.headers.get("content-length") || 0;
  if (!len || len > maxBytes()) return err(400, "bad_size");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes()) return err(413, "too_large");
  await putObject(env, key, buf, ct);
  return json({ ok: true, key, size: buf.byteLength });
}
