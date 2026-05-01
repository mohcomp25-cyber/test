// Public cashier link routes — token in URL + 6-digit PIN -> short scoped JWT.

import { all, one, run } from "../db.js";
import { verifyPin, signJwt, verifyJwt } from "../auth.js";
import { json, err, readJson, getIp, getUA } from "./_util.js";
import { recordPinAttempt, checkPinRate } from "../ratelimit.js";
import { computeClosing } from "../money.js";
import { businessDate, isValidBusinessDate } from "../date.js";
import { putObject, isAllowedType, maxBytes, signFileToken } from "../r2.js";
import { uuid } from "../ids.js";

export async function handlePublicLink(req, env, ctx) {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/api\/link\/([A-Za-z0-9_-]{20,})\/(.+)$/);
  if (!m) return err(404, "not_found");
  const token = m[1];
  const sub = m[2];

  const link = await one(env,
    `SELECT l.*, br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
     FROM cashier_links l
     JOIN brands br ON br.id=l.brand_id
     JOIN branches b ON b.id=l.branch_id
     JOIN safes s ON s.id=l.safe_id
     LEFT JOIN employees e ON e.id=l.employee_id
     WHERE l.token=?`, token);
  if (!link) return err(404, "bad_link");
  if (link.revoked_at) return err(410, "revoked");

  if (sub === "info" && req.method === "GET") {
    return json({
      brand: link.brand_name,
      branch: link.branch_name,
      safe: link.safe_name,
      employee: link.employee_name,
      label: link.label,
      requires_employee: !link.employee_id,
    });
  }

  if (sub === "verify-pin" && req.method === "POST") {
    return verifyPinRoute(req, env, link);
  }

  // From here, scoped JWT required.
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const claims = await verifyJwt(bearer, env.JWT_SECRET);
  if (!claims || claims.typ !== "link" || claims.sub !== link.id || claims.pv !== link.pin_version) {
    return err(401, "unauthorized");
  }

  if (sub === "uploads/sign" && req.method === "POST") return signUpload(req, env, link);
  const putM = sub.match(/^uploads\/put$/);
  if (putM && req.method === "PUT") return putUpload(req, env, link);
  if (sub === "closings" && req.method === "POST") return submitClosing(req, env, link);
  if (sub === "recent" && req.method === "GET") return recentClosings(env, link);
  if (sub === "branch-settings" && req.method === "GET") return branchSettings(env, link);
  if (sub === "employees" && req.method === "GET") return brandEmployees(env, link);

  return err(404, "not_found");
}

async function verifyPinRoute(req, env, link) {
  const ip = getIp(req);
  const rate = await checkPinRate(env, link.token, ip);
  if (!rate.ok) {
    return err(429, "rate_limited", { retry_after: rate.retryAfter });
  }
  const body = await readJson(req);
  const pin = String(body?.pin || "");
  if (!/^\d{4,8}$/.test(pin)) {
    await recordPinAttempt(env, link.token, ip, false);
    return err(400, "bad_pin_format");
  }
  const ok = await verifyPin(pin, link.pin_hash, env.PASSWORD_PEPPER || "");
  await recordPinAttempt(env, link.token, ip, ok);
  if (!ok) {
    if (rate.autoRevoke) {
      await run(env, `UPDATE cashier_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, link.id);
    }
    return err(401, "bad_pin");
  }
  await run(env, `UPDATE cashier_links SET last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, link.id);
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;
  const tok = await signJwt({ sub: link.id, pv: link.pin_version, exp, typ: "link" }, env.JWT_SECRET);
  return json({ token: tok, expires_in: 30 * 60 });
}

async function signUpload(req, env, link) {
  const body = await readJson(req) || {};
  const ct = String(body.content_type || "").toLowerCase();
  const size = +body.size_bytes || 0;
  const kind = String(body.kind || "");
  if (!isAllowedType(ct)) return err(400, "bad_type");
  if (size <= 0 || size > maxBytes()) return err(400, "bad_size");
  if (!["network","apps","cash_safe","custody","expense_receipt","deposit_receipt","other"].includes(kind)) return err(400, "bad_kind");
  const key = `uploads/pending/${link.id}/${uuid()}`;
  return json({ key, content_type: ct, max_bytes: maxBytes() });
}

async function putUpload(req, env, link) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (!key.startsWith(`uploads/pending/${link.id}/`)) return err(400, "bad_key");
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!isAllowedType(ct)) return err(400, "bad_type");
  const len = +req.headers.get("content-length") || 0;
  if (!len || len > maxBytes()) return err(400, "bad_size");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes()) return err(413, "too_large");
  await putObject(env, key, buf, ct);
  return json({ ok: true, key, size: buf.byteLength });
}

async function branchSettings(env, link) {
  const s = await one(env, `SELECT * FROM branch_settings WHERE branch_id=?`, link.branch_id);
  return json({ settings: s || {
    require_cash_photo: 1, require_network_photo: 1, require_apps_photo: 1, require_expense_receipt: 1,
  } });
}

async function brandEmployees(env, link) {
  const rows = await all(env,
    `SELECT id, name FROM employees WHERE brand_id=? AND archived=0 ORDER BY name ASC`, link.brand_id);
  return json({ employees: rows });
}

async function recentClosings(env, link) {
  const rows = await all(env,
    `SELECT id, business_date, shift, status, total_shift_sales_h, cash_sales_h, expected_cash_h, cash_in_safe_h, discrepancy_h, submitted_at
     FROM closings WHERE cashier_link_id=? ORDER BY id DESC LIMIT 5`, link.id);
  return json({ recent: rows });
}

async function submitClosing(req, env, link) {
  const body = await readJson(req);
  if (!body) return err(400, "bad_json");

  const business_date = isValidBusinessDate(body.business_date) ? body.business_date : businessDate();
  const shift = body.shift ? String(body.shift).slice(0, 32) : null;

  const total_shift_sales_h = Math.trunc(+body.total_shift_sales_h || 0);
  const network_sales_h = Math.trunc(+body.network_sales_h || 0);
  const apps_sales_h = Math.trunc(+body.apps_sales_h || 0);
  const apps_invoice_count = Math.max(0, Math.trunc(+body.apps_invoice_count || 0));
  const cash_in_safe_h = Math.trunc(+body.cash_in_safe_h || 0);
  const cash_custody_h = Math.trunc(+body.cash_custody_h || 0);
  const custody_expenses_h = Math.max(0, Math.trunc(+body.custody_expenses_h || 0));
  const custody_expenses_note = body.custody_expenses_note ? String(body.custody_expenses_note).slice(0, 500) : null;
  const notes = body.notes ? String(body.notes).slice(0, 1000) : null;
  const attachment_keys = Array.isArray(body.attachment_keys) ? body.attachment_keys : [];

  if ([total_shift_sales_h, network_sales_h, apps_sales_h, cash_in_safe_h, cash_custody_h].some(v => v < 0)) {
    return err(400, "negative_amount");
  }
  if (total_shift_sales_h < network_sales_h + apps_sales_h) {
    return err(400, "totals_inconsistent");
  }

  let employee_id = link.employee_id || null;
  if (!employee_id && body.employee_id) {
    const ok = await one(env, `SELECT id FROM employees WHERE id=? AND brand_id=?`, +body.employee_id, link.brand_id);
    if (!ok) return err(400, "bad_employee");
    employee_id = +body.employee_id;
  }
  if (custody_expenses_h > 0 && !employee_id) return err(400, "expense_needs_employee");

  // Validate required attachments per branch settings.
  const settings = await one(env, `SELECT * FROM branch_settings WHERE branch_id=?`, link.branch_id) || {};
  const kinds = await keyKinds(env, attachment_keys, link.id);

  const required = [];
  if (settings.require_cash_photo) required.push("cash_safe");
  if (settings.require_network_photo && network_sales_h > 0) required.push("network");
  if (settings.require_apps_photo && apps_sales_h > 0) required.push("apps");
  if (settings.require_expense_receipt && custody_expenses_h > 0) required.push("expense_receipt");
  for (const k of required) {
    if (!kinds.includes(k)) return err(400, `missing_attachment:${k}`);
  }

  // Opening cash for the safe = last closing's cash_in_safe_h, or safe.opening_balance_h.
  const last = await one(env,
    `SELECT cash_in_safe_h FROM closings WHERE safe_id=? AND status IN ('confirmed','submitted') ORDER BY id DESC LIMIT 1`,
    link.safe_id);
  let opening_cash_in_safe_h;
  if (last) {
    opening_cash_in_safe_h = last.cash_in_safe_h;
  } else {
    const s = await one(env, `SELECT opening_balance_h FROM safes WHERE id=?`, link.safe_id);
    opening_cash_in_safe_h = s?.opening_balance_h || 0;
  }

  const { cash_sales_h, expected_cash_h, discrepancy_h } = computeClosing({
    total_shift_sales_h, network_sales_h, apps_sales_h, cash_in_safe_h, opening_cash_in_safe_h,
  });

  const r = await run(env,
    `INSERT INTO closings (
       brand_id, branch_id, safe_id, employee_id, cashier_link_id,
       business_date, shift,
       total_shift_sales_h, network_sales_h, apps_sales_h, apps_invoice_count,
       cash_sales_h, cash_in_safe_h, cash_custody_h,
       custody_expenses_h, custody_expenses_note,
       opening_cash_in_safe_h, expected_cash_h, discrepancy_h,
       notes, status, submitted_ip
     ) VALUES (?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?, ?,?, ?,?,?, ?, 'submitted', ?)`,
    link.brand_id, link.branch_id, link.safe_id, employee_id, link.id,
    business_date, shift,
    total_shift_sales_h, network_sales_h, apps_sales_h, apps_invoice_count,
    cash_sales_h, cash_in_safe_h, cash_custody_h,
    custody_expenses_h, custody_expenses_note,
    opening_cash_in_safe_h, expected_cash_h, discrepancy_h,
    notes, getIp(req));
  const closingId = r.meta.last_row_id;

  for (const a of attachment_keys) {
    const key = String(a.key || "");
    const kind = String(a.kind || "other");
    const ct = String(a.content_type || "image/jpeg");
    const size = +a.size_bytes || 0;
    if (!key.startsWith(`uploads/pending/${link.id}/`)) continue;
    if (!isAllowedType(ct)) continue;
    await run(env,
      `INSERT INTO attachments (closing_id, kind, r2_key, content_type, size_bytes, created_by_kind, created_by_id)
       VALUES (?, ?, ?, ?, ?, 'cashier_link', ?)`,
      closingId, kind, key, ct, size, link.id);
  }

  await run(env,
    `INSERT INTO audit_log (actor_kind, actor_id, action, entity_table, entity_id, ip, user_agent)
     VALUES ('cashier_link', ?, 'closing.submit', 'closings', ?, ?, ?)`,
    link.id, closingId, getIp(req), getUA(req));

  return json({
    id: closingId, business_date, cash_sales_h, expected_cash_h, discrepancy_h, opening_cash_in_safe_h,
  }, { status: 201 });
}

async function keyKinds(env, attachment_keys, linkId) {
  const out = [];
  for (const a of attachment_keys) {
    if (typeof a === "object" && a && a.kind && typeof a.key === "string" && a.key.startsWith(`uploads/pending/${linkId}/`)) {
      out.push(a.kind);
    }
  }
  return out;
}
