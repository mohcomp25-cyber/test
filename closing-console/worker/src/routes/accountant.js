// Accountant-facing routes: auth, brands, branches, branch settings, safes, employees, cashier links.

import { all, one, run } from "../db.js";
import { hashPassword, verifyPassword, signJwt, setCookieHeader, clearCookieHeader, requireAccountant, hashPin } from "../auth.js";
import { json, err, readJson, csrfOk, getIp, getUA } from "./_util.js";
import { randomToken, randomPin } from "../ids.js";

export async function handleAccountant(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/auth/login" && method === "POST") return login(req, env);
  if (path === "/api/auth/logout" && method === "POST") return logout(req, env);
  if (path === "/api/auth/me" && method === "GET") return me(req, env);
  if (path === "/api/auth/change-password" && method === "POST") return changePassword(req, env);

  const acc = await requireAccountant(req, env);
  if (!acc) return err(401, "unauthorized");
  if (!csrfOk(req, method)) return err(403, "csrf");

  // Brands
  if (path === "/api/brands" && method === "GET") return listBrands(env, acc);
  if (path === "/api/brands" && method === "POST") return createBrand(req, env, acc);
  let m = path.match(/^\/api\/brands\/(\d+)$/);
  if (m && method === "GET") return getBrand(env, acc, +m[1]);
  if (m && method === "PATCH") return patchBrand(req, env, acc, +m[1]);
  if (m && method === "DELETE") return archiveBrand(env, acc, +m[1]);

  // Branches
  m = path.match(/^\/api\/brands\/(\d+)\/branches$/);
  if (m && method === "GET") return listBranches(env, acc, +m[1]);
  if (m && method === "POST") return createBranch(req, env, acc, +m[1]);
  m = path.match(/^\/api\/branches\/(\d+)$/);
  if (m && method === "PATCH") return patchBranch(req, env, acc, +m[1]);
  if (m && method === "DELETE") return archiveBranch(env, acc, +m[1]);
  m = path.match(/^\/api\/branches\/(\d+)\/settings$/);
  if (m && method === "GET") return getBranchSettings(env, acc, +m[1]);
  if (m && method === "PATCH") return patchBranchSettings(req, env, acc, +m[1]);

  // Safes
  m = path.match(/^\/api\/branches\/(\d+)\/safes$/);
  if (m && method === "GET") return listSafes(env, acc, +m[1]);
  if (m && method === "POST") return createSafe(req, env, acc, +m[1]);
  m = path.match(/^\/api\/safes\/(\d+)$/);
  if (m && method === "PATCH") return patchSafe(req, env, acc, +m[1]);
  if (m && method === "DELETE") return archiveSafe(env, acc, +m[1]);

  // Employees
  m = path.match(/^\/api\/brands\/(\d+)\/employees$/);
  if (m && method === "GET") return listEmployees(env, acc, +m[1]);
  if (m && method === "POST") return createEmployee(req, env, acc, +m[1]);
  m = path.match(/^\/api\/employees\/(\d+)$/);
  if (m && method === "PATCH") return patchEmployee(req, env, acc, +m[1]);
  if (m && method === "DELETE") return archiveEmployee(env, acc, +m[1]);
  m = path.match(/^\/api\/employees\/(\d+)\/custody-ledger$/);
  if (m && method === "GET") return employeeCustodyLedger(env, acc, +m[1]);
  m = path.match(/^\/api\/employees\/(\d+)\/custody-topup$/);
  if (m && method === "POST") return custodyTopup(req, env, acc, +m[1]);

  // Cashier links
  m = path.match(/^\/api\/brands\/(\d+)\/links$/);
  if (m && method === "GET") return listLinks(env, acc, +m[1]);
  if (m && method === "POST") return createLink(req, env, acc, +m[1]);
  m = path.match(/^\/api\/links\/(\d+)\/regenerate-pin$/);
  if (m && method === "POST") return regeneratePin(req, env, acc, +m[1]);
  m = path.match(/^\/api\/links\/(\d+)\/revoke$/);
  if (m && method === "POST") return revokeLink(env, acc, +m[1]);

  return err(404, "not_found");
}

// --- auth ---

async function login(req, env) {
  const body = await readJson(req);
  if (!body) return err(400, "bad_json");
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const acc = await one(env, `SELECT id, email, name, password_hash, disabled FROM accountants WHERE email=?`, email);
  if (!acc || acc.disabled) return err(401, "bad_credentials");
  const ok = await verifyPassword(password, acc.password_hash, env.PASSWORD_PEPPER || "");
  if (!ok) return err(401, "bad_credentials");
  await run(env, `UPDATE accountants SET last_login_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, acc.id);
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 8;
  const tok = await signJwt({ sub: acc.id, eml: acc.email, nm: acc.name, exp, typ: "accountant" }, env.JWT_SECRET);
  return new Response(JSON.stringify({ ok: true, accountant: { id: acc.id, email: acc.email, name: acc.name } }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": setCookieHeader(tok, { secure: env.ENVIRONMENT !== "dev" }),
    },
  });
}

async function logout(req, env) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "set-cookie": clearCookieHeader() },
  });
}

async function me(req, env) {
  const acc = await requireAccountant(req, env);
  if (!acc) return err(401, "unauthorized");
  return json({ accountant: acc });
}

async function changePassword(req, env) {
  const acc = await requireAccountant(req, env);
  if (!acc) return err(401, "unauthorized");
  if (!csrfOk(req, req.method)) return err(403, "csrf");
  const body = await readJson(req);
  if (!body) return err(400, "bad_json");
  const cur = String(body.current_password || "");
  const next = String(body.new_password || "");
  if (next.length < 6) return err(400, "weak_password");
  const row = await one(env, `SELECT password_hash FROM accountants WHERE id=?`, acc.id);
  if (!row || !(await verifyPassword(cur, row.password_hash, env.PASSWORD_PEPPER || ""))) return err(401, "bad_credentials");
  const h = await hashPassword(next, env.PASSWORD_PEPPER || "");
  await run(env, `UPDATE accountants SET password_hash=? WHERE id=?`, h, acc.id);
  return json({ ok: true });
}

// --- brands ---

async function listBrands(env, acc) {
  const rows = await all(env, `SELECT id, name, kind, currency, timezone, archived, created_at FROM brands WHERE accountant_id=? ORDER BY archived ASC, name ASC`, acc.id);
  return json({ brands: rows });
}

async function getBrand(env, acc, id) {
  const row = await one(env, `SELECT * FROM brands WHERE id=? AND accountant_id=?`, id, acc.id);
  if (!row) return err(404, "not_found");
  return json({ brand: row });
}

async function createBrand(req, env, acc) {
  const body = await readJson(req);
  if (!body || !body.name) return err(400, "bad_input");
  const r = await run(env, `INSERT INTO brands (accountant_id, name, kind) VALUES (?, ?, ?)`,
    acc.id, String(body.name).trim(), String(body.kind || "restaurant"));
  return json({ id: r.meta.last_row_id }, { status: 201 });
}

async function patchBrand(req, env, acc, id) {
  const own = await one(env, `SELECT id FROM brands WHERE id=? AND accountant_id=?`, id, acc.id);
  if (!own) return err(404, "not_found");
  const body = await readJson(req);
  if (!body) return err(400, "bad_json");
  const fields = [];
  const values = [];
  for (const k of ["name", "kind", "currency", "timezone"]) {
    if (typeof body[k] === "string") { fields.push(`${k}=?`); values.push(body[k]); }
  }
  if (!fields.length) return json({ ok: true });
  values.push(id);
  await run(env, `UPDATE brands SET ${fields.join(", ")} WHERE id=?`, ...values);
  return json({ ok: true });
}

async function archiveBrand(env, acc, id) {
  const own = await one(env, `SELECT id FROM brands WHERE id=? AND accountant_id=?`, id, acc.id);
  if (!own) return err(404, "not_found");
  await run(env, `UPDATE brands SET archived=1 WHERE id=?`, id);
  return json({ ok: true });
}

// --- branches ---

async function ensureBrandOwned(env, acc, brandId) {
  return await one(env, `SELECT id FROM brands WHERE id=? AND accountant_id=?`, brandId, acc.id);
}
async function ensureBranchOwned(env, acc, branchId) {
  return await one(env, `SELECT b.id, b.brand_id FROM branches b JOIN brands br ON br.id=b.brand_id WHERE b.id=? AND br.accountant_id=?`, branchId, acc.id);
}
async function ensureSafeOwned(env, acc, safeId) {
  return await one(env, `SELECT s.id, s.branch_id, b.brand_id FROM safes s JOIN branches b ON b.id=s.branch_id JOIN brands br ON br.id=b.brand_id WHERE s.id=? AND br.accountant_id=?`, safeId, acc.id);
}
async function ensureEmployeeOwned(env, acc, empId) {
  return await one(env, `SELECT e.id, e.brand_id, e.branch_id FROM employees e JOIN brands br ON br.id=e.brand_id WHERE e.id=? AND br.accountant_id=?`, empId, acc.id);
}
async function ensureLinkOwned(env, acc, linkId) {
  return await one(env, `SELECT l.* FROM cashier_links l JOIN brands br ON br.id=l.brand_id WHERE l.id=? AND br.accountant_id=?`, linkId, acc.id);
}

async function listBranches(env, acc, brandId) {
  if (!(await ensureBrandOwned(env, acc, brandId))) return err(404, "not_found");
  const rows = await all(env, `SELECT id, name, code, archived, created_at FROM branches WHERE brand_id=? ORDER BY archived ASC, name ASC`, brandId);
  return json({ branches: rows });
}

async function createBranch(req, env, acc, brandId) {
  if (!(await ensureBrandOwned(env, acc, brandId))) return err(404, "not_found");
  const body = await readJson(req);
  if (!body || !body.name) return err(400, "bad_input");
  const r = await run(env, `INSERT INTO branches (brand_id, name, code) VALUES (?, ?, ?)`,
    brandId, String(body.name).trim(), body.code ? String(body.code) : null);
  await run(env, `INSERT INTO branch_settings (branch_id) VALUES (?)`, r.meta.last_row_id);
  return json({ id: r.meta.last_row_id }, { status: 201 });
}

async function patchBranch(req, env, acc, branchId) {
  const own = await ensureBranchOwned(env, acc, branchId);
  if (!own) return err(404, "not_found");
  const body = await readJson(req);
  if (!body) return err(400, "bad_json");
  const fields = [];
  const values = [];
  for (const k of ["name", "code"]) {
    if (typeof body[k] === "string") { fields.push(`${k}=?`); values.push(body[k]); }
  }
  if (!fields.length) return json({ ok: true });
  values.push(branchId);
  await run(env, `UPDATE branches SET ${fields.join(", ")} WHERE id=?`, ...values);
  return json({ ok: true });
}

async function archiveBranch(env, acc, branchId) {
  const own = await ensureBranchOwned(env, acc, branchId);
  if (!own) return err(404, "not_found");
  await run(env, `UPDATE branches SET archived=1 WHERE id=?`, branchId);
  return json({ ok: true });
}

async function getBranchSettings(env, acc, branchId) {
  const own = await ensureBranchOwned(env, acc, branchId);
  if (!own) return err(404, "not_found");
  let row = await one(env, `SELECT * FROM branch_settings WHERE branch_id=?`, branchId);
  if (!row) {
    await run(env, `INSERT INTO branch_settings (branch_id) VALUES (?)`, branchId);
    row = await one(env, `SELECT * FROM branch_settings WHERE branch_id=?`, branchId);
  }
  return json({ settings: row });
}

async function patchBranchSettings(req, env, acc, branchId) {
  const own = await ensureBranchOwned(env, acc, branchId);
  if (!own) return err(404, "not_found");
  const body = await readJson(req) || {};
  const fields = [];
  const values = [];
  for (const k of ["require_cash_photo", "require_network_photo", "require_apps_photo", "require_expense_receipt"]) {
    if (typeof body[k] === "boolean" || body[k] === 0 || body[k] === 1) {
      fields.push(`${k}=?`);
      values.push(body[k] ? 1 : 0);
    }
  }
  if (!fields.length) return json({ ok: true });
  values.push(branchId);
  await run(env, `UPDATE branch_settings SET ${fields.join(", ")} WHERE branch_id=?`, ...values);
  return json({ ok: true });
}

// --- safes ---

async function listSafes(env, acc, branchId) {
  if (!(await ensureBranchOwned(env, acc, branchId))) return err(404, "not_found");
  const rows = await all(env, `SELECT id, name, opening_balance_h, archived, created_at FROM safes WHERE branch_id=? ORDER BY archived ASC, name ASC`, branchId);
  return json({ safes: rows });
}

async function createSafe(req, env, acc, branchId) {
  if (!(await ensureBranchOwned(env, acc, branchId))) return err(404, "not_found");
  const body = await readJson(req);
  if (!body || !body.name) return err(400, "bad_input");
  const opening = Number.isFinite(+body.opening_balance_h) ? Math.trunc(+body.opening_balance_h) : 0;
  const r = await run(env, `INSERT INTO safes (branch_id, name, opening_balance_h) VALUES (?, ?, ?)`,
    branchId, String(body.name).trim(), opening);
  return json({ id: r.meta.last_row_id }, { status: 201 });
}

async function patchSafe(req, env, acc, safeId) {
  const own = await ensureSafeOwned(env, acc, safeId);
  if (!own) return err(404, "not_found");
  const body = await readJson(req) || {};
  const fields = [];
  const values = [];
  if (typeof body.name === "string") { fields.push("name=?"); values.push(body.name); }
  if (Number.isFinite(+body.opening_balance_h)) { fields.push("opening_balance_h=?"); values.push(Math.trunc(+body.opening_balance_h)); }
  if (!fields.length) return json({ ok: true });
  values.push(safeId);
  await run(env, `UPDATE safes SET ${fields.join(", ")} WHERE id=?`, ...values);
  return json({ ok: true });
}

async function archiveSafe(env, acc, safeId) {
  const own = await ensureSafeOwned(env, acc, safeId);
  if (!own) return err(404, "not_found");
  await run(env, `UPDATE safes SET archived=1 WHERE id=?`, safeId);
  return json({ ok: true });
}

// --- employees ---

async function listEmployees(env, acc, brandId) {
  if (!(await ensureBrandOwned(env, acc, brandId))) return err(404, "not_found");
  const rows = await all(env, `SELECT id, name, phone, branch_id, custody_balance_h, archived, created_at FROM employees WHERE brand_id=? ORDER BY archived ASC, name ASC`, brandId);
  return json({ employees: rows });
}

async function createEmployee(req, env, acc, brandId) {
  if (!(await ensureBrandOwned(env, acc, brandId))) return err(404, "not_found");
  const body = await readJson(req);
  if (!body || !body.name) return err(400, "bad_input");
  const branchId = body.branch_id ? +body.branch_id : null;
  if (branchId) {
    const ok = await one(env, `SELECT id FROM branches WHERE id=? AND brand_id=?`, branchId, brandId);
    if (!ok) return err(400, "bad_branch");
  }
  const cust = Number.isFinite(+body.custody_balance_h) ? Math.trunc(+body.custody_balance_h) : 0;
  const r = await run(env,
    `INSERT INTO employees (brand_id, branch_id, name, phone, custody_balance_h) VALUES (?, ?, ?, ?, ?)`,
    brandId, branchId, String(body.name).trim(), body.phone ? String(body.phone) : null, cust);
  if (cust > 0) {
    await run(env,
      `INSERT INTO custody_movements (employee_id, business_date, kind, amount_h, ref_table, ref_id, note, created_by)
       VALUES (?, date('now'), 'topup', ?, 'employees', ?, 'افتتاحية', ?)`,
      r.meta.last_row_id, cust, r.meta.last_row_id, acc.id);
  }
  return json({ id: r.meta.last_row_id }, { status: 201 });
}

async function patchEmployee(req, env, acc, empId) {
  const own = await ensureEmployeeOwned(env, acc, empId);
  if (!own) return err(404, "not_found");
  const body = await readJson(req) || {};
  const fields = [];
  const values = [];
  if (typeof body.name === "string") { fields.push("name=?"); values.push(body.name); }
  if (typeof body.phone === "string" || body.phone === null) { fields.push("phone=?"); values.push(body.phone || null); }
  if (body.branch_id !== undefined) {
    const bid = body.branch_id ? +body.branch_id : null;
    if (bid) {
      const okBranch = await one(env, `SELECT id FROM branches WHERE id=? AND brand_id=?`, bid, own.brand_id);
      if (!okBranch) return err(400, "bad_branch");
    }
    fields.push("branch_id=?"); values.push(bid);
  }
  if (!fields.length) return json({ ok: true });
  values.push(empId);
  await run(env, `UPDATE employees SET ${fields.join(", ")} WHERE id=?`, ...values);
  return json({ ok: true });
}

async function archiveEmployee(env, acc, empId) {
  const own = await ensureEmployeeOwned(env, acc, empId);
  if (!own) return err(404, "not_found");
  await run(env, `UPDATE employees SET archived=1 WHERE id=?`, empId);
  return json({ ok: true });
}

async function employeeCustodyLedger(env, acc, empId) {
  const own = await ensureEmployeeOwned(env, acc, empId);
  if (!own) return err(404, "not_found");
  const rows = await all(env,
    `SELECT id, business_date, kind, amount_h, note, ref_table, ref_id, created_at
     FROM custody_movements WHERE employee_id=? ORDER BY id DESC LIMIT 500`, empId);
  const bal = await one(env, `SELECT custody_balance_h FROM employees WHERE id=?`, empId);
  return json({ balance_h: bal?.custody_balance_h || 0, movements: rows });
}

async function custodyTopup(req, env, acc, empId) {
  const own = await ensureEmployeeOwned(env, acc, empId);
  if (!own) return err(404, "not_found");
  const body = await readJson(req) || {};
  const amt = Math.trunc(+body.amount_h || 0);
  if (!amt) return err(400, "bad_amount");
  const note = body.note ? String(body.note) : null;
  const kind = amt > 0 ? "topup" : "return";
  await run(env, `UPDATE employees SET custody_balance_h = custody_balance_h + ? WHERE id=?`, amt, empId);
  await run(env,
    `INSERT INTO custody_movements (employee_id, business_date, kind, amount_h, note, created_by)
     VALUES (?, date('now'), ?, ?, ?, ?)`,
    empId, kind, amt, note, acc.id);
  return json({ ok: true });
}

// --- cashier links ---

async function listLinks(env, acc, brandId) {
  if (!(await ensureBrandOwned(env, acc, brandId))) return err(404, "not_found");
  const rows = await all(env,
    `SELECT l.id, l.brand_id, l.branch_id, l.safe_id, l.employee_id, l.token, l.label, l.created_at, l.revoked_at, l.last_used_at,
            br.name AS branch_name, s.name AS safe_name, e.name AS employee_name
     FROM cashier_links l
     LEFT JOIN branches br ON br.id=l.branch_id
     LEFT JOIN safes s ON s.id=l.safe_id
     LEFT JOIN employees e ON e.id=l.employee_id
     WHERE l.brand_id=? ORDER BY l.id DESC`, brandId);
  return json({ links: rows });
}

async function createLink(req, env, acc, brandId) {
  if (!(await ensureBrandOwned(env, acc, brandId))) return err(404, "not_found");
  const body = await readJson(req);
  if (!body) return err(400, "bad_input");
  const branchId = +body.branch_id, safeId = +body.safe_id;
  const empId = body.employee_id ? +body.employee_id : null;
  if (!branchId || !safeId) return err(400, "missing_fields");
  const ok1 = await one(env, `SELECT b.id FROM branches b WHERE b.id=? AND b.brand_id=?`, branchId, brandId);
  const ok2 = await one(env, `SELECT s.id FROM safes s WHERE s.id=? AND s.branch_id=?`, safeId, branchId);
  if (!ok1 || !ok2) return err(400, "bad_scope");
  if (empId) {
    const oke = await one(env, `SELECT id FROM employees WHERE id=? AND brand_id=?`, empId, brandId);
    if (!oke) return err(400, "bad_employee");
  }
  const token = randomToken(32);
  const pin = randomPin(6);
  const pinHash = await hashPin(pin, env.PASSWORD_PEPPER || "");
  const r = await run(env,
    `INSERT INTO cashier_links (brand_id, branch_id, safe_id, employee_id, token, pin_hash, label)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    brandId, branchId, safeId, empId, token, pinHash, body.label ? String(body.label) : null);
  return json({ id: r.meta.last_row_id, token, pin }, { status: 201 });
}

async function regeneratePin(req, env, acc, linkId) {
  const own = await ensureLinkOwned(env, acc, linkId);
  if (!own) return err(404, "not_found");
  const pin = randomPin(6);
  const pinHash = await hashPin(pin, env.PASSWORD_PEPPER || "");
  await run(env, `UPDATE cashier_links SET pin_hash=?, pin_version=pin_version+1 WHERE id=?`, pinHash, linkId);
  return json({ ok: true, pin });
}

async function revokeLink(env, acc, linkId) {
  const own = await ensureLinkOwned(env, acc, linkId);
  if (!own) return err(404, "not_found");
  await run(env, `UPDATE cashier_links SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, linkId);
  return json({ ok: true });
}
