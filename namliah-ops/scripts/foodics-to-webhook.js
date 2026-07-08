'use strict';
// أداة CLI لتحويل ملفات فودكس وإرسالها للمنصة (نفس منطق src/services/foodics.js).
// الاستخدام:
//   node scripts/foodics-to-webhook.js --orders o.csv --items i.csv --payments p.csv \
//     [--date YYYY-MM-DD] [--post URL] [--secret S | --secret-jeddah S --secret-abha S]
// الملفات المدموجة متعددة الفروع تُقسَّم تلقائياً؛ كل فرع يُرسل لمفتاحه
// (WEBHOOK_SECRET_<BRANCH> من البيئة أو --secret-<branch>). بدون --post يطبع JSON.

const fs = require('fs');
const { parseCsv, transformByBranch } = require('../src/services/foodics');

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
  const o = arg('orders'); const i = arg('items'); const p = arg('payments');
  if (!o || !i || !p) {
    console.error('الاستخدام: node scripts/foodics-to-webhook.js --orders o.csv --items i.csv --payments p.csv [--date YYYY-MM-DD] [--post URL] [--secret S | --secret-jeddah S --secret-abha S]');
    process.exit(1);
  }
  const groups = transformByBranch(
    parseCsv(fs.readFileSync(o, 'utf8')),
    parseCsv(fs.readFileSync(i, 'utf8')),
    parseCsv(fs.readFileSync(p, 'utf8')),
    arg('date')
  );
  const postUrl = arg('post');
  for (const g of groups) {
    if (!g.key) { console.warn(`تجاهل فرع غير معروف: ${g.name}`); continue; }
    if (g.payload.summary.orders_count === 0) { console.log(`فرع ${g.key}: لا طلبات مكتملة — تخطّي`); continue; }
    if (!postUrl) {
      console.log(`# فرع ${g.key} (${g.payload.summary.total_sales} ر.س):`);
      console.log(JSON.stringify(g.payload, null, 2));
      continue;
    }
    const secret = arg(`secret-${g.key}`) || process.env[`WEBHOOK_SECRET_${g.key.toUpperCase()}`] || arg('secret') || process.env.WEBHOOK_SECRET;
    const r = await postPayload(postUrl, secret, g.payload);
    console.log(`فرع ${g.key} (${g.payload.summary.total_sales} ر.س، ${g.payload.summary.orders_count} طلب) →`, r.status, r.text);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
