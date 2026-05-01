// Bank deposit routes (accountant).

import { all, one, run } from "../db.js";
import { requireAccountant } from "../auth.js";
import { json, err, readJson, csrfOk } from "./_util.js";
import { isAllowedType, putObject, signFileToken } from "../r2.js";
import { uuid } from "../ids.js";
import { isValidBusinessDate, businessDate } from "../date.js";

export async function handleDeposits(req, env) {
  const acc = await requireAccountant(req, env);
  if (!acc) return err(401, "unauthorized");
  if (!csrfOk(req, req.method)) return err(403, "csrf");
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  let m = path.match(/^\/api\/safes\/(\d+)\/deposits$/);
  if (m && method === "GET") return list(env, acc, +m[1]);
  if (m && method === "POST") return create(req, env, acc, +m[1]);
  m = path.match(/^\/api\/deposits\/(\d+)$/);
  if (m && method === "DELETE") return del(env, acc, +m[1]);
  m = path.match(/^\/api\/deposits\/(\d+)\/attachments$/);
  if (m && method === "GET") return listAttachments(env, acc, +m[1]);
  return err(404, "not_found");
}

async function ownsSafe(env, acc, safeId) {
  return one(env,
    `SELECT s.id, s.branch_id, b.brand_id FROM safes s JOIN branches b ON b.id=s.branch_id
     JOIN brands br ON br.id=b.brand_id WHERE s.id=? AND br.accountant_id=?`, safeId, acc.id);
}

async function ownsDeposit(env, acc, depId) {
  return one(env,
    `SELECT d.* FROM bank_deposits d JOIN brands br ON br.id=d.brand_id
     WHERE d.id=? AND br.accountant_id=?`, depId, acc.id);
}

async function list(env, acc, safeId) {
  const own = await ownsSafe(env, acc, safeId);
  if (!own) return err(404, "not_found");
  const rows = await all(env,
    `SELECT d.id, d.amount_h, d.business_date, d.bank_name, d.reference, d.notes, d.created_at,
            (SELECT COUNT(*) FROM attachments a WHERE a.deposit_id=d.id) AS attachments_count
     FROM bank_deposits d WHERE d.safe_id=? ORDER BY d.business_date DESC, d.id DESC`, safeId);
  return json({ deposits: rows });
}

async function create(req, env, acc, safeId) {
  const own = await ownsSafe(env, acc, safeId);
  if (!own) return err(404, "not_found");
  const body = await readJson(req);
  if (!body) return err(400, "bad_json");
  const amount = Math.trunc(+body.amount_h || 0);
  if (amount <= 0) return err(400, "bad_amount");
  const bd = isValidBusinessDate(body.business_date) ? body.business_date : businessDate();
  const r = await run(env,
    `INSERT INTO bank_deposits (safe_id, brand_id, branch_id, amount_h, business_date, bank_name, reference, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    safeId, own.brand_id, own.branch_id, amount, bd,
    body.bank_name ? String(body.bank_name) : null,
    body.reference ? String(body.reference) : null,
    body.notes ? String(body.notes) : null,
    acc.id);

  const depId = r.meta.last_row_id;

  // Attach receipts that were uploaded via /api/uploads/put with key prefix uploads/console/{accId}/
  const attachments = Array.isArray(body.attachment_keys) ? body.attachment_keys : [];
  for (const a of attachments) {
    const key = String(a.key || "");
    const ct = String(a.content_type || "image/jpeg");
    const size = +a.size_bytes || 0;
    if (!key.startsWith(`uploads/console/${acc.id}/`)) continue;
    if (!isAllowedType(ct)) continue;
    await run(env,
      `INSERT INTO attachments (deposit_id, kind, r2_key, content_type, size_bytes, created_by_kind, created_by_id)
       VALUES (?, 'deposit_receipt', ?, ?, ?, 'accountant', ?)`,
      depId, key, ct, size, acc.id);
  }

  await run(env,
    `INSERT INTO cash_movements (safe_id, business_date, kind, amount_h, ref_table, ref_id, note, created_by)
     VALUES (?, ?, 'deposit', ?, 'bank_deposits', ?, ?, ?)`,
    safeId, bd, -amount, depId, `deposit #${depId}`, acc.id);

  return json({ id: depId }, { status: 201 });
}

async function del(env, acc, depId) {
  const own = await ownsDeposit(env, acc, depId);
  if (!own) return err(404, "not_found");
  await run(env, `DELETE FROM cash_movements WHERE ref_table='bank_deposits' AND ref_id=?`, depId);
  await run(env, `DELETE FROM bank_deposits WHERE id=?`, depId);
  return json({ ok: true });
}

async function listAttachments(env, acc, depId) {
  const own = await ownsDeposit(env, acc, depId);
  if (!own) return err(404, "not_found");
  const rows = await all(env,
    `SELECT id, kind, content_type, size_bytes, r2_key, created_at FROM attachments WHERE deposit_id=? ORDER BY id ASC`, depId);
  const items = [];
  for (const a of rows) {
    const t = await signFileToken(env, a.r2_key, 300);
    items.push({ ...a, url: `/api/files?t=${t}` });
  }
  return json({ attachments: items });
}
