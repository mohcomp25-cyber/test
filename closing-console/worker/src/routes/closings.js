// Closings routes (accountant): list, detail, confirm, reject.

import { all, one, run } from "../db.js";
import { requireAccountant } from "../auth.js";
import { json, err, readJson, csrfOk, getIp, getUA, intOr } from "./_util.js";
import { signFileToken } from "../r2.js";

export async function handleClosings(req, env) {
  const acc = await requireAccountant(req, env);
  if (!acc) return err(401, "unauthorized");
  if (!csrfOk(req, req.method)) return err(403, "csrf");

  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/closings" && method === "GET") return list(env, acc, url);
  let m = path.match(/^\/api\/closings\/(\d+)$/);
  if (m && method === "GET") return detail(env, acc, +m[1]);
  m = path.match(/^\/api\/closings\/(\d+)\/confirm$/);
  if (m && method === "POST") return confirmClosing(req, env, acc, +m[1]);
  m = path.match(/^\/api\/closings\/(\d+)\/reject$/);
  if (m && method === "POST") return rejectClosing(req, env, acc, +m[1]);
  return err(404, "not_found");
}

async function list(env, acc, url) {
  const sp = url.searchParams;
  const where = ["br.accountant_id = ?"];
  const params = [acc.id];
  for (const [k, col] of [["brand_id","c.brand_id"],["branch_id","c.branch_id"],["safe_id","c.safe_id"],["employee_id","c.employee_id"],["status","c.status"]]) {
    const v = sp.get(k);
    if (v) { where.push(`${col} = ?`); params.push(k === "status" ? v : +v); }
  }
  const from = sp.get("from"), to = sp.get("to");
  if (from) { where.push("c.business_date >= ?"); params.push(from); }
  if (to) { where.push("c.business_date <= ?"); params.push(to); }
  const page = Math.max(1, intOr(sp.get("page"), 1));
  const pageSize = Math.min(100, Math.max(10, intOr(sp.get("page_size"), 30)));
  const offset = (page - 1) * pageSize;

  const rows = await all(env,
    `SELECT c.id, c.business_date, c.shift, c.status,
            c.total_shift_sales_h, c.network_sales_h, c.apps_sales_h, c.apps_invoice_count,
            c.cash_sales_h, c.cash_in_safe_h, c.expected_cash_h, c.discrepancy_h,
            c.submitted_at, c.confirmed_at,
            c.brand_id, c.branch_id, c.safe_id, c.employee_id,
            br2.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
     FROM closings c
     JOIN brands br2 ON br2.id=c.brand_id
     JOIN brands br ON br.id=c.brand_id
     JOIN branches b ON b.id=c.branch_id
     JOIN safes s ON s.id=c.safe_id
     LEFT JOIN employees e ON e.id=c.employee_id
     WHERE ${where.join(" AND ")}
     ORDER BY c.business_date DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    ...params, pageSize, offset);

  const total = await one(env,
    `SELECT COUNT(*) AS c FROM closings c JOIN brands br ON br.id=c.brand_id WHERE ${where.join(" AND ")}`,
    ...params);

  return json({ closings: rows, page, page_size: pageSize, total: total?.c || 0 });
}

async function detail(env, acc, id) {
  const row = await one(env,
    `SELECT c.*, br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name,
            l.token AS link_token, l.label AS link_label
     FROM closings c
     JOIN brands br ON br.id=c.brand_id
     JOIN branches b ON b.id=c.branch_id
     JOIN safes s ON s.id=c.safe_id
     LEFT JOIN employees e ON e.id=c.employee_id
     JOIN cashier_links l ON l.id=c.cashier_link_id
     WHERE c.id=? AND br.accountant_id=?`, id, acc.id);
  if (!row) return err(404, "not_found");
  const atts = await all(env,
    `SELECT id, kind, content_type, size_bytes, r2_key, created_at FROM attachments WHERE closing_id=? ORDER BY id ASC`, id);
  const items = [];
  for (const a of atts) {
    const t = await signFileToken(env, a.r2_key, 300);
    items.push({ ...a, url: `/api/files?t=${t}` });
  }
  return json({ closing: row, attachments: items });
}

async function confirmClosing(req, env, acc, id) {
  const row = await one(env,
    `SELECT c.* FROM closings c JOIN brands br ON br.id=c.brand_id
     WHERE c.id=? AND br.accountant_id=?`, id, acc.id);
  if (!row) return err(404, "not_found");
  if (row.status !== "submitted") return err(409, "bad_state");

  await run(env,
    `UPDATE closings SET status='confirmed', confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), confirmed_by=? WHERE id=?`,
    acc.id, id);

  await run(env,
    `INSERT INTO cash_movements (safe_id, business_date, kind, amount_h, ref_table, ref_id, note, created_by)
     VALUES (?, ?, 'closing_confirmed', ?, 'closings', ?, ?, ?)`,
    row.safe_id, row.business_date, row.cash_sales_h, id, `closing #${id}`, acc.id);

  if (row.custody_expenses_h > 0 && row.employee_id) {
    await run(env,
      `UPDATE employees SET custody_balance_h = custody_balance_h - ? WHERE id=?`,
      row.custody_expenses_h, row.employee_id);
    await run(env,
      `INSERT INTO custody_movements (employee_id, business_date, kind, amount_h, ref_table, ref_id, note, created_by)
       VALUES (?, ?, 'expense', ?, 'closings', ?, ?, ?)`,
      row.employee_id, row.business_date, -row.custody_expenses_h, id,
      row.custody_expenses_note || `closing #${id}`, acc.id);
  }

  await run(env,
    `INSERT INTO audit_log (actor_kind, actor_id, action, entity_table, entity_id, ip, user_agent)
     VALUES ('accountant', ?, 'closing.confirm', 'closings', ?, ?, ?)`,
    acc.id, id, getIp(req), getUA(req));

  return json({ ok: true });
}

async function rejectClosing(req, env, acc, id) {
  const row = await one(env,
    `SELECT c.* FROM closings c JOIN brands br ON br.id=c.brand_id
     WHERE c.id=? AND br.accountant_id=?`, id, acc.id);
  if (!row) return err(404, "not_found");
  if (row.status !== "submitted") return err(409, "bad_state");
  const body = await readJson(req) || {};
  const reason = body.reason ? String(body.reason).slice(0, 500) : "rejected";
  await run(env, `UPDATE closings SET status='rejected', reject_reason=? WHERE id=?`, reason, id);
  await run(env,
    `INSERT INTO audit_log (actor_kind, actor_id, action, entity_table, entity_id, meta_json, ip, user_agent)
     VALUES ('accountant', ?, 'closing.reject', 'closings', ?, ?, ?, ?)`,
    acc.id, id, JSON.stringify({ reason }), getIp(req), getUA(req));
  return json({ ok: true });
}
