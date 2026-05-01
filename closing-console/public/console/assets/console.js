// Shared client helpers for the accountant console.

export const api = {
  base: "",
  async req(method, path, body, opts = {}) {
    const init = {
      method,
      headers: { "x-dcc-csrf": "1" },
      credentials: "include",
    };
    if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (opts.raw) Object.assign(init, opts.raw);
    const r = await fetch(this.base + path, init);
    if (r.status === 401) {
      if (location.pathname !== "/console/login.html") location.href = "/console/login.html";
      throw new Error("unauthorized");
    }
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await r.json() : await r.text();
    if (!r.ok) {
      const e = new Error(data?.error || `http_${r.status}`);
      e.status = r.status;
      e.data = data;
      throw e;
    }
    return data;
  },
  get(p) { return this.req("GET", p); },
  post(p, b) { return this.req("POST", p, b ?? {}); },
  patch(p, b) { return this.req("PATCH", p, b ?? {}); },
  del(p) { return this.req("DELETE", p); },
  async putBlob(path, blob, contentType) {
    const r = await fetch(this.base + path, {
      method: "PUT",
      headers: { "x-dcc-csrf": "1", "content-type": contentType },
      body: blob,
      credentials: "include",
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `http_${r.status}`);
    return data;
  },
};

export function fmt(h) {
  if (h === null || h === undefined) return "—";
  const n = Number(h);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${whole.toLocaleString("en")}.${cents}`;
}
export function fmtSAR(h) { return `${fmt(h)} ر.س`; }

export function parseAmount(s) {
  if (s === null || s === undefined || s === "") return 0;
  const t = String(s).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error("bad");
  const [w, frac = ""] = t.split(".");
  const cents = (frac + "00").slice(0, 2);
  const sign = w.startsWith("-") ? -1 : 1;
  return sign * (Number(w.replace("-", "")) * 100 + Number(cents));
}

export function fmtDate(s) {
  if (!s) return "—";
  return s.slice(0, 10);
}
export function fmtDateTime(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayBusinessDate() {
  const d = new Date();
  const shifted = new Date(d.getTime() + 180 * 60000);
  return shifted.toISOString().slice(0, 10);
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) continue;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function toast(msg, kind = "ok") {
  let t = document.querySelector(".toast");
  if (!t) {
    t = el("div", { class: "toast" });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.toggle("err", kind === "err");
  t.classList.add("on");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("on"), 2800);
}

export function modal(title, content, actions) {
  const bg = el("div", { class: "modal-bg on" });
  const m = el("div", { class: "modal" });
  m.append(el("h3", {}, title));
  if (typeof content === "string") m.append(el("div", { html: content }));
  else if (Array.isArray(content)) m.append(...content);
  else m.append(content);
  const close = () => bg.remove();
  const acts = el("div", { class: "actions" });
  for (const a of (actions || [{ label: "إغلاق", onClick: close }])) {
    const b = el("button", { class: a.class || "ghost" }, a.label);
    b.addEventListener("click", () => a.onClick?.(close));
    acts.append(b);
  }
  m.append(acts);
  bg.append(m);
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  document.body.append(bg);
  return { close, root: m };
}

export function topbar(activePage, accName) {
  const bar = el("div", { class: "topbar" },
    el("div", { class: "brand" }, "DCC"),
    el("div", { class: "spacer" }),
    el("div", { class: "who" }, accName ? `أهلاً، ${accName}` : ""),
    el("button", { class: "tiny ghost", onclick: async () => {
      await api.post("/api/auth/logout");
      location.href = "/console/login.html";
    } }, "خروج"),
  );

  const nav = el("div", { class: "nav" });
  const items = [
    ["dashboard", "الرئيسية", "/console/index.html"],
    ["closings", "التقفيلات", "/console/closings.html"],
    ["safes", "جرد الخزنة", "/console/safes.html"],
    ["deposits", "إيداعات البنك", "/console/deposits.html"],
    ["brands", "البراندات", "/console/brands.html"],
    ["branches", "الفروع", "/console/branches.html"],
    ["employees", "الموظفين", "/console/employees.html"],
    ["links", "روابط الكاشير", "/console/links.html"],
    ["reports", "التقارير", "/console/reports.html"],
  ];
  for (const [k, label, href] of items) {
    nav.append(el("a", { href, class: k === activePage ? "active" : "" }, label));
  }
  return [bar, nav];
}

export async function ensureAuth() {
  try {
    const r = await api.get("/api/auth/me");
    return r.accountant;
  } catch (_e) {
    location.href = "/console/login.html";
    return null;
  }
}

export function discrepancyCell(h) {
  const n = Number(h);
  const cls = n > 0 ? "discrepancy-pos" : n < 0 ? "discrepancy-neg" : "discrepancy-zero";
  return el("span", { class: cls }, fmt(h));
}

export function statusBadge(s) {
  const map = {
    submitted: ["badge warn", "بانتظار التأكيد"],
    confirmed: ["badge", "مؤكد"],
    rejected: ["badge red", "مرفوض"],
  };
  const [c, t] = map[s] || ["badge muted", s];
  return el("span", { class: c }, t);
}

export async function uploadOne(file, sign) {
  const buf = await file.arrayBuffer();
  await api.putBlob(`/api/uploads/put?key=${encodeURIComponent(sign.key)}`, buf, sign.content_type);
  return { key: sign.key, content_type: file.type, size_bytes: file.size };
}
