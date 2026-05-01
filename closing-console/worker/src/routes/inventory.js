// Safe inventory + reports.

import { all, one } from "../db.js";
import { requireAccountant } from "../auth.js";
import { json, err, csrfOk } from "./_util.js";
import { rangeFor, businessDate, isValidBusinessDate } from "../date.js";

export async function handleInventory(req, env) {
  const acc = await requireAccountant(req, env);
  if (!acc) return err(401, "unauthorized");
  if (!csrfOk(req, req.method)) return err(403, "csrf");
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  let m = path.match(/^\/api\/safes\/(\d+)\/balance$/);
  if (m && method === "GET") return safeBalance(env, acc, +m[1], url);
  m = path.match(/^\/api\/safes\/(\d+)\/ledger$/);
  if (m && method === "GET") return safeLedger(env, acc, +m[1], url);
  if (path === "/api/reports/eod" && method === "GET") return reportEod(env, acc, url);
  if (path === "/api/reports/range" && method === "GET") return reportRange(env, acc, url);
  return err(404, "not_found");
}

async function ownsSafe(env, acc, safeId) {
  return one(env,
    `SELECT s.id, s.branch_id, s.opening_balance_h, b.brand_id, br.name AS brand_name, b.name AS branch_name, s.name AS safe_name
     FROM safes s JOIN branches b ON b.id=s.branch_id JOIN brands br ON br.id=b.brand_id
     WHERE s.id=? AND br.accountant_id=?`, safeId, acc.id);
}

async function safeBalance(env, acc, safeId, url) {
  const own = await ownsSafe(env, acc, safeId);
  if (!own) return err(404, "not_found");
  const at = url.searchParams.get("at") || businessDate();
  const sum = await one(env,
    `SELECT COALESCE(SUM(amount_h),0) AS s FROM cash_movements WHERE safe_id=? AND business_date<=?`,
    safeId, at);
  return json({ safe: own, at, balance_h: (own.opening_balance_h || 0) + (sum?.s || 0) });
}

async function safeLedger(env, acc, safeId, url) {
  const own = await ownsSafe(env, acc, safeId);
  if (!own) return err(404, "not_found");
  const period = url.searchParams.get("period") || "day";
  const anchor = url.searchParams.get("anchor") || businessDate();
  const fromQ = url.searchParams.get("from");
  const toQ = url.searchParams.get("to");
  let from, to;
  if (fromQ && toQ && isValidBusinessDate(fromQ) && isValidBusinessDate(toQ)) {
    from = fromQ; to = toQ;
  } else {
    ({ from, to } = rangeFor(period, anchor));
  }

  const opening = await one(env,
    `SELECT COALESCE(SUM(amount_h),0) AS s FROM cash_movements WHERE safe_id=? AND business_date<?`,
    safeId, from);
  const opening_h = (own.opening_balance_h || 0) + (opening?.s || 0);

  const movements = await all(env,
    `SELECT id, business_date, kind, amount_h, ref_table, ref_id, note, created_at
     FROM cash_movements WHERE safe_id=? AND business_date>=? AND business_date<=?
     ORDER BY business_date ASC, id ASC`, safeId, from, to);

  let running = opening_h;
  const enriched = movements.map(m => {
    running += m.amount_h;
    return { ...m, running_h: running };
  });
  return json({ safe: own, from, to, opening_h, closing_h: running, movements: enriched });
}

async function reportEod(env, acc, url) {
  const date = url.searchParams.get("date") || businessDate();
  const brandId = url.searchParams.get("brand_id");
  const where = ["br.accountant_id=?"];
  const params = [acc.id];
  if (brandId) { where.push("c.brand_id=?"); params.push(+brandId); }
  where.push("c.business_date=?");
  params.push(date);
  const rows = await all(env,
    `SELECT c.id, c.brand_id, c.branch_id, c.safe_id, c.employee_id, c.business_date, c.shift, c.status,
            br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name,
            c.total_shift_sales_h, c.network_sales_h, c.apps_sales_h, c.apps_invoice_count,
            c.cash_sales_h, c.cash_in_safe_h, c.cash_custody_h, c.custody_expenses_h,
            c.opening_cash_in_safe_h, c.expected_cash_h, c.discrepancy_h, c.notes
     FROM closings c
     JOIN brands br ON br.id=c.brand_id
     JOIN branches b ON b.id=c.branch_id
     JOIN safes s ON s.id=c.safe_id
     LEFT JOIN employees e ON e.id=c.employee_id
     WHERE ${where.join(" AND ")}
     ORDER BY c.brand_id, c.branch_id, c.safe_id`, ...params);
  const fmt = url.searchParams.get("format") || "json";
  if (fmt === "csv") return csvResponse(rows, `eod-${date}.csv`);
  const totals = aggregate(rows);
  return json({ date, rows, totals });
}

async function reportRange(env, acc, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isValidBusinessDate(from) || !isValidBusinessDate(to)) return err(400, "bad_range");
  const brandId = url.searchParams.get("brand_id");
  const where = ["br.accountant_id=?", "c.business_date>=?", "c.business_date<=?"];
  const params = [acc.id, from, to];
  if (brandId) { where.push("c.brand_id=?"); params.push(+brandId); }
  const rows = await all(env,
    `SELECT c.id, c.brand_id, c.branch_id, c.safe_id, c.employee_id, c.business_date, c.shift, c.status,
            br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name,
            c.total_shift_sales_h, c.network_sales_h, c.apps_sales_h, c.apps_invoice_count,
            c.cash_sales_h, c.cash_in_safe_h, c.cash_custody_h, c.custody_expenses_h,
            c.opening_cash_in_safe_h, c.expected_cash_h, c.discrepancy_h
     FROM closings c
     JOIN brands br ON br.id=c.brand_id
     JOIN branches b ON b.id=c.branch_id
     JOIN safes s ON s.id=c.safe_id
     LEFT JOIN employees e ON e.id=c.employee_id
     WHERE ${where.join(" AND ")}
     ORDER BY c.business_date, c.brand_id, c.branch_id, c.safe_id`, ...params);
  const fmt = url.searchParams.get("format") || "json";
  if (fmt === "csv") return csvResponse(rows, `range-${from}_${to}.csv`);
  return json({ from, to, rows, totals: aggregate(rows) });
}

function aggregate(rows) {
  const t = { total_shift_sales_h: 0, network_sales_h: 0, apps_sales_h: 0, cash_sales_h: 0, cash_in_safe_h: 0, expected_cash_h: 0, discrepancy_h: 0, apps_invoice_count: 0 };
  for (const r of rows) {
    for (const k of Object.keys(t)) t[k] += r[k] || 0;
  }
  return t;
}

function csvResponse(rows, filename) {
  const cols = [
    "business_date","shift","brand_name","branch_name","safe_name","employee_name","status",
    "total_shift_sales_h","network_sales_h","apps_sales_h","apps_invoice_count",
    "cash_sales_h","cash_in_safe_h","cash_custody_h","custody_expenses_h",
    "opening_cash_in_safe_h","expected_cash_h","discrepancy_h",
  ];
  const head = cols.join(",");
  const lines = rows.map(r => cols.map(c => csvCell(r[c])).join(","));
  const csv = "﻿" + head + "\n" + lines.join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
