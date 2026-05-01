# Daily Closing Console (DCC)

كونسول تقفيل اليوميات للمطاعم والكافيهات. يدير عدة براندات وفروع وخزائن، يولّد روابط تقفيل محمية بـ PIN للكاشيرات، يستقبل صور الإثباتات (شبكة، تطبيقات، كاش، إيصالات مصاريف، إيصالات إيداع بنك)، يحتسب العجز/الزيادة تلقائياً، ويعرض جرد الخزنة (يومي/أسبوعي/شهري).

> هذا المشروع منفصل عن تطبيق DLVR في جذر الريبو. كل ملفاته معزولة تحت `closing-console/` ليسهل نقله لاحقاً لريبو خاص به.

## البنية

| المجلد | الدور |
|---|---|
| `worker/src/` | Cloudflare Worker (JS) — REST API |
| `worker/migrations/` | D1 SQL migrations |
| `console/` | واجهة المحاسب (HTML/CSS/JS) |
| `cashier/` | واجهة الكاشير (الرابط بـ PIN) |

## التشغيل المحلي

```bash
cd closing-console
npm install
npx wrangler d1 create dcc                       # مرة واحدة، انسخ database_id لـ wrangler.toml
npx wrangler d1 migrations apply dcc --local
npx wrangler r2 bucket create dcc-attachments    # مرة واحدة
echo "secret-value" | npx wrangler secret put JWT_SECRET --local
echo "pepper-value" | npx wrangler secret put PASSWORD_PEPPER --local
npx wrangler dev --local --persist-to .wrangler/state
```

ثم افتح `http://localhost:8787/console/login.html`.

لإنشاء حساب محاسب أول في وضع التطوير:

```bash
curl -X POST http://localhost:8787/api/_dev/seed-accountant \
  -H "content-type: application/json" \
  -d '{"email":"owner@example.com","password":"pass1234","name":"المالك"}'
```

## الصيغة المالية

كل المبالغ تخزّن كـ `INTEGER` بوحدة الهللة (SAR × 100) لتجنب أخطاء الفاصلة العائمة.

```
inferred_cash_sales = total_shift_sales - network_sales - apps_sales
opening_cash_in_safe = آخر cash_in_safe لنفس الخزنة، أو الرصيد الافتتاحي
expected_cash       = opening_cash_in_safe + inferred_cash_sales - 0
discrepancy         = cash_in_safe - expected_cash
```

مصاريف العهدة الدائمة تنزّل من رصيد عهدة الموظف (`employees.custody_balance_h`) ولا تؤثر على الخزنة.

## النشر

```bash
npx wrangler d1 migrations apply dcc --remote
npx wrangler secret put JWT_SECRET
npx wrangler secret put PASSWORD_PEPPER
npx wrangler deploy
```
