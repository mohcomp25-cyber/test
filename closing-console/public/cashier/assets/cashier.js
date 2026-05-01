// Cashier (public link) flow.

const url = new URL(location.href);
const token = url.searchParams.get("t");
const root = document.getElementById("app");

if (!token) {
  root.innerHTML = `<div class="result"><div class="icon" style="border-color:var(--red);color:var(--red);background:rgba(255,61,87,.15);">!</div><div class="title">رابط غير صحيح</div><div class="sub">تأكد من نسخ الرابط بالكامل</div></div>`;
  throw new Error("no token");
}

const SS_KEY = `dcc_link_${token}`;
let scoped = sessionStorage.getItem(SS_KEY) || null;
let info = null;
let settings = null;
let employees = [];

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) continue;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

function fmt(h) {
  const n = Number(h) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${whole.toLocaleString("en")}.${cents}`;
}

function parseAmount(s) {
  if (s === null || s === undefined || s === "") return 0;
  const t = String(s).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error("bad");
  const [w, frac = ""] = t.split(".");
  const cents = (frac + "00").slice(0, 2);
  const sign = w.startsWith("-") ? -1 : 1;
  return sign * (Number(w.replace("-", "")) * 100 + Number(cents));
}

function todayBusinessDate() {
  const d = new Date();
  const shifted = new Date(d.getTime() + 180 * 60000);
  return shifted.toISOString().slice(0, 10);
}

function toast(msg, kind = "ok") {
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", { class: "toast" }); document.body.append(t); }
  t.textContent = msg;
  t.classList.toggle("err", kind === "err");
  t.classList.add("on");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("on"), 3500);
}

async function api(method, sub, body, opts = {}) {
  const headers = { "x-dcc-csrf": "1" };
  const init = { method, headers };
  if (scoped && !opts.skipAuth) headers.authorization = `Bearer ${scoped}`;
  if (body !== undefined && !opts.raw) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  } else if (opts.raw) {
    Object.assign(init, opts.raw);
  }
  const r = await fetch(`/api/link/${token}/${sub}`, init);
  let data = null;
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) data = await r.json();
  if (!r.ok) {
    const e = new Error((data && data.error) || `http_${r.status}`);
    e.status = r.status; e.data = data;
    throw e;
  }
  return data;
}

async function start() {
  try {
    info = await api("GET", "info", undefined, { skipAuth: true });
  } catch (e) {
    if (e.status === 410) {
      root.innerHTML = `<div class="result"><div class="icon" style="border-color:var(--red);color:var(--red);background:rgba(255,61,87,.15);">!</div><div class="title">الرابط ملغى</div><div class="sub">تواصل مع المحاسب لإصدار رابط جديد</div></div>`;
      return;
    }
    if (e.status === 404) {
      root.innerHTML = `<div class="result"><div class="icon" style="border-color:var(--red);color:var(--red);background:rgba(255,61,87,.15);">!</div><div class="title">الرابط غير موجود</div></div>`;
      return;
    }
    throw e;
  }

  if (!scoped) return showPin();
  try {
    await loadFormDeps();
    showForm();
  } catch (e) {
    if (e.status === 401) { sessionStorage.removeItem(SS_KEY); scoped = null; return showPin(); }
    throw e;
  }
}

function showPin() {
  root.innerHTML = "";
  root.append(headerBar());
  const card = el("div", { class: "pin-card" });
  card.append(el("div", { class: "pin-title" }, "أدخل الـ PIN"),
    el("div", { class: "pin-sub" }, "الرقم السري المرسل من المحاسب"));
  const inp = el("input", { class: "pin-in", type: "tel", inputmode: "numeric", maxlength: 8, autocomplete: "off", autofocus: true });
  const errLine = el("div", { class: "pin-err" });
  const btn = el("button", { class: "primary", style: "margin-top:14px;" }, "دخول");
  card.append(inp, errLine, btn);
  root.append(card);

  inp.addEventListener("input", () => { errLine.textContent = ""; });
  btn.addEventListener("click", submit);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });

  async function submit() {
    const pin = inp.value.trim();
    if (!/^\d{4,8}$/.test(pin)) { errLine.textContent = "ادخل أرقام فقط"; return; }
    btn.disabled = true; btn.textContent = "...جاري التحقق";
    try {
      const r = await api("POST", "verify-pin", { pin }, { skipAuth: true });
      scoped = r.token;
      sessionStorage.setItem(SS_KEY, scoped);
      await loadFormDeps();
      showForm();
    } catch (e) {
      if (e.status === 429) {
        const retry = e.data?.retry_after || 900;
        errLine.textContent = `محاولات كثيرة، حاول بعد ${Math.ceil(retry / 60)} دقيقة`;
      } else if (e.status === 401) {
        errLine.textContent = "PIN غير صحيح";
      } else {
        errLine.textContent = "خطأ في الاتصال";
      }
      btn.disabled = false; btn.textContent = "دخول";
      inp.select();
    }
  }
}

async function loadFormDeps() {
  settings = (await api("GET", "branch-settings")).settings;
  if (info.requires_employee) {
    employees = (await api("GET", "employees")).employees;
  }
}

function headerBar() {
  return el("div", { class: "header" },
    el("div", { class: "brand" }, "DCC"),
    el("div", { class: "ctx" },
      el("b", {}, info?.brand || ""),
      `${info?.branch || ""} · ${info?.safe || ""}`,
      info?.employee ? ` · ${info.employee}` : "",
    ));
}

function showForm() {
  root.innerHTML = "";
  root.append(headerBar());

  const wrap = el("div", { id: "form" });
  root.append(wrap);

  // Section 1: amounts
  const s1 = el("div", { class: "section" });
  s1.append(el("h3", {}, "أرقام الشفت"));

  const totalI = numField("إجمالي مبيعات الشفت (ر.س)", "0.00", { autofocus: true });
  const netI = numField("مبيعات الشبكة (ر.س)", "0.00");
  const appsI = numField("مبيعات التطبيقات (ر.س)", "0.00");
  const appsCntI = numField("عدد فواتير التطبيقات", "0", { plain: true });

  s1.append(totalI.field, netI.field, appsI.field, appsCntI.field);

  const banner = el("div", { class: "summary-card" });
  s1.append(banner);

  // Section 2: cash + custody
  const s2 = el("div", { class: "section" });
  s2.append(el("h3", {}, "الكاش والعهدة"));
  const cashSafeI = numField("الكاش الموجود بالخزنة (ر.س)", "0.00");
  const cashCustI = numField("كاش العهدة بيد الكاشير (ر.س)", "0.00");
  const expensesI = numField("مصاريف العهدة في هذا الشفت (ر.س)", "0.00");
  const expensesNote = el("textarea", { rows: 2, placeholder: "مثلاً: تنظيف، مواد..." });
  const expensesField = el("div", { class: "field" }, el("label", {}, "ملاحظة المصاريف"), expensesNote);
  s2.append(cashSafeI.field, cashCustI.field, expensesI.field, expensesField);

  let empSel = null;
  if (info.requires_employee) {
    empSel = el("select", {},
      el("option", { value: "" }, "— اختر الموظف —"),
      ...employees.map(e => el("option", { value: e.id }, e.name)));
    s2.insertBefore(el("div", { class: "field" }, el("label", {}, "الموظف"), empSel), s2.children[1]);
  }

  // Section 3: attachments
  const s3 = el("div", { class: "section" });
  s3.append(el("h3", {}, "المرفقات"));
  const attRows = {};
  const kindRows = [
    ["cash_safe", "صورة الكاش بالخزنة", "require_cash_photo", () => true],
    ["network", "صورة تقرير الشبكة", "require_network_photo", () => parseSafe(netI.input.value) > 0],
    ["apps", "صورة تقارير التطبيقات", "require_apps_photo", () => parseSafe(appsI.input.value) > 0],
    ["expense_receipt", "صورة إيصال مصاريف العهدة", "require_expense_receipt", () => parseSafe(expensesI.input.value) > 0],
    ["other", "مرفق إضافي (اختياري)", null, () => true],
  ];
  for (const [kind, label, reqKey, when] of kindRows) {
    const row = attachmentRow(kind, label);
    attRows[kind] = { ...row, reqKey, when };
    s3.append(row.row);
  }

  // Notes
  const s4 = el("div", { class: "section" });
  s4.append(el("h3", {}, "ملاحظات (اختياري)"));
  const notes = el("textarea", { rows: 3, placeholder: "أي ملاحظات..." });
  s4.append(el("div", { class: "field" }, notes));

  const submitBtn = el("button", { class: "primary", style: "padding:14px;font-size:15px;margin-bottom:10px;" }, "إرسال التقفيل");
  const errLine = el("div", { style: "text-align:center;font-size:12px;color:var(--red);min-height:20px;font-weight:700;" });

  wrap.append(s1, s2, s3, s4, submitBtn, errLine);

  function recompute() {
    const total = parseSafe(totalI.input.value);
    const net = parseSafe(netI.input.value);
    const apps = parseSafe(appsI.input.value);
    const cash = total - net - apps;
    const cashSafe = parseSafe(cashSafeI.input.value);
    banner.innerHTML = "";
    banner.append(
      sumRow("مبيعات الكاش (محسوبة)", fmt(cash) + " ر.س"),
      sumRow("الكاش الفعلي بالخزنة", fmt(cashSafe) + " ر.س"),
    );
    if (cash < 0) {
      banner.append(el("div", { class: "discrepancy-banner neg", style: "margin-top:8px;" },
        "تحذير: الإجمالي أقل من شبكة + تطبيقات"));
    }
    // toggle required hints
    for (const [kind, r] of Object.entries(attRows)) {
      const required = r.reqKey ? !!settings[r.reqKey] && r.when() : false;
      r.hint.textContent = required ? (r.fileKey ? "تم الإرفاق ✓" : "مطلوب") : (r.fileKey ? "تم الإرفاق ✓" : "");
      r.hint.className = required && !r.fileKey ? "req" : "ok";
    }
  }

  for (const x of [totalI, netI, appsI, appsCntI, cashSafeI, cashCustI, expensesI]) {
    x.input.addEventListener("input", recompute);
  }
  recompute();

  submitBtn.addEventListener("click", async () => {
    errLine.textContent = "";
    let body;
    try {
      body = {
        business_date: todayBusinessDate(),
        total_shift_sales_h: parseAmount(totalI.input.value || "0"),
        network_sales_h: parseAmount(netI.input.value || "0"),
        apps_sales_h: parseAmount(appsI.input.value || "0"),
        apps_invoice_count: Math.max(0, parseInt(appsCntI.input.value || "0", 10) || 0),
        cash_in_safe_h: parseAmount(cashSafeI.input.value || "0"),
        cash_custody_h: parseAmount(cashCustI.input.value || "0"),
        custody_expenses_h: parseAmount(expensesI.input.value || "0"),
        custody_expenses_note: expensesNote.value.trim() || null,
        notes: notes.value.trim() || null,
      };
    } catch {
      errLine.textContent = "أحد الأرقام غير صحيح"; return;
    }
    if (info.requires_employee) {
      if (!empSel || !empSel.value) { errLine.textContent = "اختر الموظف"; return; }
      body.employee_id = +empSel.value;
    }
    if (body.total_shift_sales_h < body.network_sales_h + body.apps_sales_h) {
      errLine.textContent = "الإجمالي أقل من شبكة + تطبيقات";
      return;
    }
    // Validate required attachments
    const missing = [];
    for (const [kind, r] of Object.entries(attRows)) {
      if (!r.reqKey) continue;
      if (settings[r.reqKey] && r.when() && !r.fileKey) missing.push(kindLabel(kind));
    }
    if (missing.length) { errLine.textContent = `مطلوب صور: ${missing.join("، ")}`; return; }

    submitBtn.disabled = true; submitBtn.textContent = "...جاري الإرسال";
    try {
      const attachment_keys = [];
      for (const [kind, r] of Object.entries(attRows)) {
        if (r.fileKey) attachment_keys.push({ key: r.fileKey, kind, content_type: r.fileType, size_bytes: r.fileSize });
      }
      body.attachment_keys = attachment_keys;
      const result = await api("POST", "closings", body);
      showResult(result);
    } catch (e) {
      submitBtn.disabled = false; submitBtn.textContent = "إرسال التقفيل";
      if (e.status === 401) { sessionStorage.removeItem(SS_KEY); scoped = null; return showPin(); }
      const code = e.data?.error || "خطأ";
      errLine.textContent = friendlyErr(code);
    }
  });
}

function friendlyErr(code) {
  if (code.startsWith("missing_attachment:")) {
    return `مطلوب صورة: ${kindLabel(code.split(":")[1])}`;
  }
  return ({
    expense_needs_employee: "اختر موظف لربط مصاريف العهدة به",
    bad_employee: "موظف غير صحيح",
    totals_inconsistent: "الإجمالي أقل من شبكة + تطبيقات",
    negative_amount: "لا يمكن إدخال مبلغ سالب",
  })[code] || `خطأ: ${code}`;
}

function kindLabel(k) {
  return ({
    cash_safe: "الكاش بالخزنة",
    network: "تقرير الشبكة",
    apps: "تقارير التطبيقات",
    expense_receipt: "إيصال مصاريف العهدة",
    other: "أخرى",
  })[k] || k;
}

function sumRow(lbl, val) {
  return el("div", { class: "summary-row" },
    el("span", { class: "lbl" }, lbl),
    el("span", { class: "val" }, val));
}

function numField(label, ph, opts = {}) {
  const input = el("input", {
    type: "text",
    inputmode: opts.plain ? "numeric" : "decimal",
    placeholder: ph,
    autofocus: opts.autofocus ? "" : null,
    autocomplete: "off",
  });
  const field = el("div", { class: "field" }, el("label", {}, label), input);
  return { field, input };
}

function parseSafe(s) {
  try { return parseAmount(s || "0"); } catch { return 0; }
}

function attachmentRow(kind, label) {
  const id = `f_${kind}`;
  const fileInput = el("input", { id, type: "file", accept: "image/*,application/pdf", capture: "environment" });
  const labelBtn = el("label", { class: "btn", for: id }, "رفع");
  const preview = el("img", { class: "preview", style: "display:none;" });
  const hint = el("div", { class: "req" });
  const obj = { row: null, fileKey: null, fileType: null, fileSize: 0, hint };
  const row = el("div", { class: "attachment-row" },
    preview,
    el("div", { class: "name" }, label, el("br"), hint),
    labelBtn,
  );
  obj.row = row;

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast("الملف أكبر من 8MB", "err"); fileInput.value = ""; return; }
    labelBtn.textContent = "...جار الرفع";
    try {
      const sign = await api("POST", "uploads/sign", { content_type: f.type, size_bytes: f.size, kind });
      const buf = await f.arrayBuffer();
      const r = await fetch(`/api/link/${token}/uploads/put?key=${encodeURIComponent(sign.key)}`, {
        method: "PUT",
        headers: { "x-dcc-csrf": "1", "content-type": f.type, "authorization": `Bearer ${scoped}` },
        body: buf,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "fail");
      obj.fileKey = sign.key;
      obj.fileType = f.type;
      obj.fileSize = f.size;
      labelBtn.textContent = "تغيير";
      labelBtn.classList.add("has");
      if (f.type.startsWith("image/")) {
        const url = URL.createObjectURL(f);
        preview.src = url;
        preview.style.display = "block";
      }
      // Trigger recompute hint
      document.querySelector(".section input")?.dispatchEvent(new Event("input"));
    } catch (e) {
      toast("فشل رفع الملف", "err");
      labelBtn.textContent = "رفع";
    }
  });

  row.append(fileInput);
  return obj;
}

async function showResult(r) {
  root.innerHTML = "";
  root.append(headerBar());
  const isOk = Math.abs(r.discrepancy_h) === 0;
  const cls = isOk ? "zero" : (r.discrepancy_h > 0 ? "pos" : "neg");
  const txt = isOk ? "مطابق" : (r.discrepancy_h > 0 ? `زيادة ${fmt(r.discrepancy_h)} ر.س` : `عجز ${fmt(Math.abs(r.discrepancy_h))} ر.س`);
  const card = el("div", { class: "section" },
    el("div", { class: "result" },
      el("div", { class: "icon" }, "✓"),
      el("div", { class: "title" }, "تم إرسال التقفيل"),
      el("div", { class: "sub" }, `للتاريخ: ${r.business_date}`),
    ),
    el("div", { class: "summary-card" },
      sumRow("افتتاحية الخزنة", fmt(r.opening_cash_in_safe_h) + " ر.س"),
      sumRow("مبيعات الكاش (محسوبة)", fmt(r.cash_sales_h) + " ر.س"),
      sumRow("الكاش المتوقع بالخزنة", fmt(r.expected_cash_h) + " ر.س"),
    ),
    el("div", { class: `discrepancy-banner ${cls}` }, txt),
    el("button", { class: "ghost", style: "margin-top:10px;", onclick: () => location.reload() }, "تقفيل آخر"),
  );
  root.append(card);

  // Recent
  try {
    const recent = (await api("GET", "recent")).recent;
    if (recent.length) {
      const sec = el("div", { class: "section" });
      sec.append(el("h3", {}, "آخر التقفيلات لهذا الرابط"));
      const list = el("div", { class: "recent" });
      for (const c of recent) {
        const sign = c.discrepancy_h === 0 ? "—" : (c.discrepancy_h > 0 ? "+" : "−");
        const cls = c.discrepancy_h === 0 ? "" : (c.discrepancy_h > 0 ? "" : "color:var(--red);");
        list.append(el("div", { class: "row" },
          el("span", {}, c.business_date),
          el("span", { style: cls }, `${sign} ${fmt(Math.abs(c.discrepancy_h))}`)));
      }
      sec.append(list);
      root.append(sec);
    }
  } catch (_) {}
}

start().catch(e => {
  console.error(e);
  root.innerHTML = `<div class="result"><div class="title">خطأ</div><div class="sub">${e.message || ""}</div></div>`;
});
