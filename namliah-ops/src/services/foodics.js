'use strict';
// تحويل ملفات فودكس الثلاثة (طلبات/أصناف/دفعات) إلى حمولات المنصة لكل فرع.
// وحدة نقية بلا I/O — يستخدمها كلٌّ من سكربت CLI ونقطة الـ API.

// ---- محلل CSV مصغر (يدعم الحقول المقتبسة والفواصل داخل الاقتباس و BOM) ----
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text).replace(/^﻿/, '');
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
  const header = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const num = (v) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

// ---- تحويل صفوف فرع واحد ليوم واحد إلى حمولة المنصة ----
function transform(orders, items, payments, forcedDate) {
  const date = forcedDate ||
    (orders.find((o) => o.business_date)?.business_date) || null;
  if (!date) return null; // لا بيانات

  const dayOrders = orders.filter((o) => o.business_date === date);
  const doneOrders = dayOrders.filter((o) => o.status === 'Done');
  const doneRefs = new Set(doneOrders.map((o) => o.reference));

  const totalSales = doneOrders.reduce((a, o) => a + num(o.total_price), 0);
  const ordersCount = doneOrders.length;

  // الخصومات: كوبونات (طلب فيه coupon_code) / خصومات أخرى / إلغاءات (Void + طلبات غير مكتملة)
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

  // طرق الدفع (دفعات الطلبات المكتملة فقط)
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
    if (!doneRefs.has(p.order_reference)) continue;
    const key = methodKey(p.payment_method_name);
    paymentBreakdown[key] = +((paymentBreakdown[key] || 0) + num(p.amount)).toFixed(2);
  }

  // توزيع الصالة على الموظفين (closed_by) + الاستلام
  const hallTotals = {};
  let takeaway = 0;
  for (const o of doneOrders) {
    if (o.type === 'Dine In') {
      const who = o.closed_by && o.closed_by !== '-' ? o.closed_by : (o.created_by || 'غير محدد');
      hallTotals[who] = +((hallTotals[who] || 0) + num(o.total_price)).toFixed(2);
    } else {
      takeaway = +(takeaway + num(o.total_price)).toFixed(2);
    }
  }
  const hallSales = Object.entries(hallTotals)
    .map(([waiter, total]) => ({ waiter, total }))
    .sort((a, b) => b.total - a.total);

  // المبيعات بالساعة + أول/آخر طلب من created_at
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

  // تفاصيل الأصناف (غير الملغاة، من طلبات مكتملة) مجمعة بالاسم العربي
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
      deductions: { coupons: +coupons.toFixed(2), discounts: +discounts.toFixed(2), cancellations },
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

// يقسّم الملفات المدموجة حسب الفرع ويعيد [{ key, name, payload }]
function transformByBranch(orders, items, payments, forcedDate) {
  const names = [...new Set(orders.map((o) => o.branch_name).filter(Boolean))];
  const out = [];
  if (!names.length) {
    const payload = transform(orders, items, payments, forcedDate);
    if (payload) out.push({ key: 'jeddah', name: null, payload });
    return out;
  }
  for (const name of names) {
    const key = branchKey(name);
    if (!key) { out.push({ key: null, name, skipped: 'unknown_branch' }); continue; }
    const flt = (rows) => rows.filter((r) => r.branch_name === name);
    const payload = transform(flt(orders), flt(items), flt(payments), forcedDate);
    if (payload) out.push({ key, name, payload });
  }
  return out;
}

module.exports = { parseCsv, num, transform, branchKey, transformByBranch };
