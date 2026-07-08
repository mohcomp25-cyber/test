'use strict';
// تحويل ملفات فودكس اليومية الثلاثة إلى حمولة webhook منصة نملية.
// نفس المنطق المستخدم في عقدة Code داخل وورك فلو n8n (موثق في docs/foodics-n8n.md).
//
// الاستخدام:
//   node scripts/foodics-to-webhook.js --orders orders.csv --items items.csv --payments payments.csv
//   [--date 2026-07-05]                    يستنتج التاريخ من business_date إن غاب
//   [--post http://localhost:3000 --secret WEBHOOK_SECRET]   لإرسال الحمولة مباشرة
//
// بدون --post يطبع JSON الحمولة على stdout.

const fs = require('fs');

// ---- محلل CSV مصغر (يدعم الحقول المقتبسة والفواصل داخل الاقتباس و BOM) ----
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const num = (v) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

// ---- التحويل ----
function transform(orders, items, payments, forcedDate) {
  const date = forcedDate ||
    (orders.find((o) => o.business_date)?.business_date) || null;
  if (!date) throw new Error('لا يمكن استنتاج business_date');

  const dayOrders = orders.filter((o) => o.business_date === date);
  const doneOrders = dayOrders.filter((o) => o.status === 'Done');
  const doneRefs = new Set(doneOrders.map((o) => o.reference));

  // الإجمالي وعدد الطلبات: الطلبات المكتملة فقط
  const totalSales = doneOrders.reduce((a, o) => a + num(o.total_price), 0);
  const ordersCount = doneOrders.length;

  // الخصومات: كوبونات (طلبات فيها coupon_code) / خصومات أخرى / إلغاءات
  // الإلغاءات = قيمة الأصناف الملغاة (Void) + قيمة الطلبات غير المكتملة (Declined…)
  let coupons = 0;
  let discounts = 0;
  for (const o of dayOrders) {
    const d = num(o.discounts);
    if (!d) continue;
    if (o.coupon_code && o.coupon_code !== '-') coupons += d;
    else discounts += d;
  }
  const dayItems = items.filter((i) => i.business_date === date);
  const voidValue = dayItems
    .filter((i) => i.status === 'Void')
    .reduce((a, i) => a + num(i.total_price), 0);
  const declinedValue = dayOrders
    .filter((o) => o.status !== 'Done')
    .reduce((a, o) => a + num(o.total_price), 0);
  const cancellations = +(voidValue + declinedValue).toFixed(2);

  // طرق الدفع (دفعات الطلبات المكتملة فقط): Card→card · Cash→cash · Qlub/QlubQSR→qlub
  const paymentBreakdown = {};
  const methodKey = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('cash') || name.includes('كاش') || name.includes('نقد')) return 'cash';
    if (n.includes('qlub')) return 'qlub';
    if (n.includes('card') || n.includes('mada') || name.includes('شبكة')) return 'card';
    return 'other';
  };
  for (const p of payments) {
    if (p.business_date !== date) continue;
    if (!doneRefs.has(p.order_reference)) continue; // استبعاد دفعات الطلبات الملغاة
    const key = methodKey(p.payment_method_name);
    paymentBreakdown[key] = +((paymentBreakdown[key] || 0) + num(p.amount)).toFixed(2);
  }

  // توزيع الصالة على الموظفين (closed_by) للطلبات المكتملة من نوع Dine In
  const hallTotals = {};
  let takeaway = 0;
  for (const o of doneOrders) {
    if (o.type === 'Dine In') {
      const who = o.closed_by && o.closed_by !== '-' ? o.closed_by : (o.created_by || 'غير محدد');
      hallTotals[who] = +((hallTotals[who] || 0) + num(o.total_price)).toFixed(2);
    } else {
      // أي نوع آخر (To Go / Pick Up …) يُحسب استلاماً
      takeaway = +(takeaway + num(o.total_price)).toFixed(2);
    }
  }
  const hallSales = Object.entries(hallTotals)
    .map(([waiter, total]) => ({ waiter, total }))
    .sort((a, b) => b.total - a.total);

  // المبيعات بالساعة + أول/آخر طلب من created_at (بتوقيت الفرع)
  const hourly = {};
  let firstTs = null;
  let lastTs = null;
  for (const o of doneOrders) {
    const ts = (o.created_at || '').replace(/"/g, '');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(ts)) continue;
    const hour = Number(ts.slice(11, 13));
    if (!hourly[hour]) hourly[hour] = { hour, total: 0, orders: 0 };
    hourly[hour].total = +(hourly[hour].total + num(o.total_price)).toFixed(2);
    hourly[hour].orders++;
    if (!firstTs || ts < firstTs) firstTs = ts;
    if (!lastTs || ts > lastTs) lastTs = ts;
  }

  // تفاصيل الأصناف (غير الملغاة، من طلبات مكتملة) مجمعة بالاسم
  const products = {};
  for (const i of dayItems) {
    if (i.status !== 'Done' || i.order_status !== 'Done') continue;
    if (i.type !== 'Product') continue;
    const name = (i.name || '').split(' - ')[0].trim() || i.name;
    if (!products[name]) products[name] = { product_name: name, category: null, qty: 0, unit_price: num(i.unit_price), total: 0 };
    products[name].qty += num(i.quantity);
    products[name].total = +(products[name].total + num(i.total_price)).toFixed(2);
  }
  const lines = Object.values(products).sort((a, b) => b.total - a.total);

  return {
    date,
    summary: {
      total_sales: +totalSales.toFixed(2),
      orders_count: ordersCount,
      deductions: {
        coupons: +coupons.toFixed(2),
        discounts: +discounts.toFixed(2),
        cancellations
      },
      payment_breakdown: paymentBreakdown,
      hall_sales: hallSales,
      external_sales: { takeaway },
      hourly_sales: Object.values(hourly),
      first_order_at: firstTs ? firstTs.slice(11, 16) : undefined,
      last_order_at: lastTs ? lastTs.slice(11, 16) : undefined
    },
    lines
  };
}

// اسم فرع فودكس → مفتاح الفرع في المنصة
function branchKey(name) {
  const n = (name || '').trim().toLowerCase();
  if (n.includes('jeddah') || n.includes('جدة') || n.includes('جده')) return 'jeddah';
  if (n.includes('abha') || n.includes('أبها') || n.includes('ابها')) return 'abha';
  if (n.includes('makk') || n.includes('mecca') || n.includes('مكة') || n.includes('مكه')) return 'makkah';
  return null;
}

// يقسّم الملفات المدموجة حسب الفرع ويبني حمولة لكل فرع
function transformByBranch(orders, items, payments, forcedDate) {
  const names = [...new Set(orders.map((o) => o.branch_name).filter(Boolean))];
  const out = [];
  if (!names.length) {
    // لا عمود فرع → عامل الكل كجدة
    out.push({ key: 'jeddah', name: null, payload: transform(orders, items, payments, forcedDate) });
    return out;
  }
  for (const name of names) {
    const key = branchKey(name);
    if (!key) { console.warn(`تجاهل فرع غير معروف: ${name}`); continue; }
    const flt = (rows) => rows.filter((r) => r.branch_name === name);
    out.push({ key, name, payload: transform(flt(orders), flt(items), flt(payments), forcedDate) });
  }
  return out;
}

// ---- CLI ----
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

async function postPayload(postUrl, secret, payload) {
  const res = await fetch(`${postUrl.replace(/\/$/, '')}/api/webhook/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret || '' },
    body: JSON.stringify(payload)
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  const ordersPath = arg('orders');
  const itemsPath = arg('items');
  const paymentsPath = arg('payments');
  if (!ordersPath || !itemsPath || !paymentsPath) {
    console.error('الاستخدام: node scripts/foodics-to-webhook.js --orders o.csv --items i.csv --payments p.csv [--date YYYY-MM-DD] [--post URL] [--secret S | --secret-jeddah S --secret-abha S]');
    console.error('الملفات المدموجة متعددة الفروع تُقسَّم تلقائياً حسب branch_name، ويُرسل كل فرع لمفتاحه (WEBHOOK_SECRET_<BRANCH> من البيئة أو --secret-<branch>).');
    process.exit(1);
  }
  const groups = transformByBranch(
    parseCsv(fs.readFileSync(ordersPath, 'utf8')),
    parseCsv(fs.readFileSync(itemsPath, 'utf8')),
    parseCsv(fs.readFileSync(paymentsPath, 'utf8')),
    arg('date')
  );

  const postUrl = arg('post');
  for (const g of groups) {
    if (g.payload.summary.orders_count === 0) {
      console.log(`فرع ${g.key}: لا طلبات مكتملة — تخطّي`);
      continue;
    }
    if (!postUrl) {
      console.log(`# فرع ${g.key} (${g.payload.summary.total_sales} ر.س):`);
      console.log(JSON.stringify(g.payload, null, 2));
      continue;
    }
    const secret = arg(`secret-${g.key}`)
      || process.env[`WEBHOOK_SECRET_${g.key.toUpperCase()}`]
      || arg('secret') || process.env.WEBHOOK_SECRET;
    const r = await postPayload(postUrl, secret, g.payload);
    console.log(`فرع ${g.key} (${g.payload.summary.total_sales} ر.س، ${g.payload.summary.orders_count} طلب) →`, r.status, r.text);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });

module.exports = { parseCsv, transform, transformByBranch, branchKey };
