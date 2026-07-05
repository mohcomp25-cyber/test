# منصة عمليات نملية — Namliah Ops Platform

منصة عربية (RTL) لإدارة العمليات اليومية لفروع نملية (جدة - أبها - مكة):

- **استقبال آلي** لبيانات اليومية وتفاصيل المبيعات من وورك فلو خارجي (n8n / Make) عبر Webhook مؤمّن.
- **صفحة مدير التشغيل** (حساب لكل فرع): مراجعة مبيعات اليوم، ملاحظات الخصومات والملاحظات المصنفة، ثم **اعتماد التقرير ونشره** وتصديره PDF.
- **صفحة الإدارة**: داشبورد تحليلي كامل (اتجاه المبيعات، أفضل الأصناف، طرق الدفع، قنوات البيع، الملاحظات) يظهر فيه كل تقرير فور اعتماده.
- **مراجعات قوقل ماب** (نصوص + صور + ردود المطعم) تُسحب عبر Apify يومياً وتظهر في التقرير والداشبورد.

التقنية: Node.js + Express + SQLite (better-sqlite3) — خادم واحد بدون خدمات خارجية، وواجهة بدون خطوة بناء.

---

## التشغيل السريع

```bash
cd namliah-ops
npm ci                 # أو npm install
cp .env.example .env   # واملأ القيم (خصوصاً SESSION_SECRET و WEBHOOK_SECRET)
npm run seed           # بيانات تجريبية: مستخدمان + ٣٠ يوم مبيعات + مراجعات
npm start              # http://localhost:3000
```

حسابات الدخول الافتراضية (من البذر التجريبي):

| الدور | اسم المستخدم | كلمة المرور |
|---|---|---|
| مدير التشغيل | `ops` | `namliah-ops-2026` |
| الإدارة | `admin` | `namliah-admin-2026` |

> ⚠️ غيّر كلمات المرور فور أول دخول عبر `POST /api/auth/password`، وامسح البيانات التجريبية عند الربط الفعلي بـ `npm run wipe-demo`.

---

## الفروع

الفروع المعرفة: **جدة (jeddah)** — **أبها (abha)** — **مكة (makkah)**. المفعّل حالياً جدة. لكل فرع:

- **مفتاح webhook خاص** (`WEBHOOK_SECRET_<BRANCH>`) — المنصة تعرف الفرع من المفتاح المُرسل.
- **رابط قوقل ماب خاص** (`GOOGLE_MAPS_URL_<BRANCH>`) لمزامنة مراجعاته.
- **مدير تشغيل خاص** يرى تقارير فرعه فقط ويظهر اسم فرعه في أعلى الصفحة.
- إعداد عدد طاولات مستقل (لمتوسط مبيعات الطاولة).

**لتفعيل فرع جديد (مثال أبها):**

```bash
# 1) أنشئ مستخدم مدير الفرع
node scripts/add-user.js abha_manager "كلمة-مرور-قوية" ops abha
# 2) أضف في .env
#    WEBHOOK_SECRET_ABHA=<مفتاح جديد>
#    GOOGLE_MAPS_URL_ABHA=<رابط الفرع في قوقل ماب>
# 3) أعد تشغيل الخادم ووجّه وورك فلو الفرع للمفتاح الجديد
```

الإدارة ترى كل الفروع مع فلتر (كل الفروع / جدة / أبها / مكة) في الداشبورد.

---

## عقد الـ Webhook (للوورك فلو في n8n / Make)

أرسل يومياً طلب `POST` إلى:

```
POST https://<your-domain>/api/webhook/sales
Content-Type: application/json
X-Webhook-Secret: <مفتاح الفرع: WEBHOOK_SECRET_JEDDAH مثلاً>
```

> الفرع يُحدد تلقائياً من المفتاح السري — وورك فلو كل فرع يستخدم مفتاحه.

بالجسم التالي:

```json
{
  "date": "2026-07-05",
  "summary": {
    "total_sales": 12450.75,
    "orders_count": 183,
    "avg_ticket": 68.04,
    "deductions": { "coupons": 320.00, "discounts": 145.50, "cancellations": 89.00 },
    "deduction_notes": { "coupons": "٣ بلوقر", "cancellations": "إرجاع طلب فيه مشكلة" },
    "payment_breakdown": { "cash": 2100.00, "card": 7350.75, "online": 3000.00 },
    "hall_sales": [
      { "waiter": "جورج", "total": 2100.00 },
      { "waiter": "إيلي", "total": 1750.50 }
    ],
    "external_sales": {
      "takeaway": 2250.75,
      "hungerstation": 2400.00,
      "jahez": 1600.00
    }
  },
  "lines": [
    { "product_name": "شاورما عربي", "category": "ساندويشات", "qty": 42, "unit_price": 17.00, "total": 714.00 }
  ]
}
```

ملاحظات العقد:

- `date` بصيغة `YYYY-MM-DD` (يوم العمل بتوقيت الرياض) — **تقرير واحد لكل يوم**.
- `avg_ticket` اختياري؛ يُحسب تلقائياً من `total_sales / orders_count` إن غاب.
- `deductions` اختياري: الكوبونات المخصومة، الخصومات، والإلغاءات — تظهر تحت إجمالي المبيعات.
- `deduction_notes` اختياري: نص توضيحي مقابل كل بند خصم — ومدير التشغيل يستطيع كتابته/تعديله من المنصة قبل الاعتماد.
- `hall_sales` اختياري: مبيعات الصالة موزعة على الويترز `[{waiter, total}]` — تظهر في قسم «توزيع المبيعات» ويُحسب منها متوسط مبيعات الطاولة (بقسمة إجمالي الصالة على عدد الطاولات الذي يضبطه مدير التشغيل من المنصة).
- `external_sales` اختياري: الطلبات الخارجية — حالياً «استلام» (`takeaway`) فقط، وأي مفاتيح إضافية تُعرض تلقائياً إن وردت. الاسم القديم `channel_breakdown` ما زال مقبولاً.
- `payment_breakdown` اختياري ومفاتيحه حرة (cash، card، online…).
- **إعادة الإرسال لنفس اليوم**: إذا كان التقرير غير معتمد تُستبدل بياناته بالكامل (والملاحظات تبقى). إذا كان معتمداً يُرفض بـ `409` حفاظاً على التقرير المنشور — اعتبرها نجاحاً في منطق إعادة المحاولة.

| الرد | المعنى |
|---|---|
| `200 {"status":"created"}` | يوم جديد سُجّل |
| `200 {"status":"updated"}` | تحديث يوم غير معتمد |
| `400 {"error":"validation","fields":[...]}` | حقول ناقصة/خاطئة |
| `401` | مفتاح `X-Webhook-Secret` خاطئ أو غير مضبوط |
| `409 {"error":"report_already_approved"}` | اليوم معتمد ومقفل |

---

## مراجعات قوقل ماب (Apify)

1. أنشئ توكن من [Apify Console](https://console.apify.com/account#/integrations) وضعه في `APIFY_TOKEN`.
2. ضع رابط صفحة كل فرع في قوقل ماب في `GOOGLE_MAPS_URL_JEDDAH` (و`_ABHA`/`_MAKKAH` عند التفعيل).
3. الـ actor الافتراضي: [`compass/google-maps-reviews-scraper`](https://apify.com/compass/google-maps-reviews-scraper) — يسحب النصوص والتقييمات وصور المراجعات وردود المطعم.

المزامنة تعمل تلقائياً كل يوم **3:30 فجراً بتوقيت الرياض** (قابلة للتغيير عبر `REVIEWS_CRON`)، ويمكن تشغيلها يدوياً بزر «مزامنة الآن» من أي صفحة. التصنيف: ⭐ ٤+ إيجابي، ٣ محايد، ٢ وأقل سلبي.

بدون توكن تعمل المنصة طبيعياً وتظهر حالة «المزامنة غير مُفعّلة».

---

## الـ API

| المسار | الصلاحية | الوظيفة |
|---|---|---|
| `POST /api/auth/login` `logout` — `GET /api/auth/me` — `POST /api/auth/password` | — | الدخول والجلسات |
| `POST /api/webhook/sales` | مفتاح سري | استقبال اليومية |
| `GET /api/ops/report?date=` · `GET /api/ops/dates` | ops | عرض التقرير والأيام |
| `PUT /api/ops/report/:date/notes` | ops | حفظ الملاحظات (قبل الاعتماد) |
| `POST /api/ops/report/:date/approve` | ops | الاعتماد = النشر للإدارة (نهائي) |
| `GET /api/admin/reports` · `/report/:date` · `/dashboard` | admin | التقارير المعتمدة والتحليلات |
| `GET /api/reviews` · `/stats` — `POST /api/reviews/sync` | مسجّل دخول | المراجعات والمزامنة |
| `GET /report/:date/print` | مسجّل دخول | صفحة التصدير (اطبع أو احفظ PDF من المتصفح) |

---

## النشر على سيرفر (VPS)

```bash
# Node 18+ مطلوب
npm ci --omit=dev
cp .env.example .env && nano .env    # SESSION_SECRET و WEBHOOK_SECRET إلزاميان
npm run seed                          # أول مرة فقط
pm2 start server.js --name namliah-ops
pm2 save
```

ضع Caddy (أو nginx) أمام التطبيق للحصول على HTTPS — المفتاح السري للـ webhook يجب ألا يمر إلا عبر HTTPS:

```
# Caddyfile
ops.namliah.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

وفعّل `COOKIE_SECURE=1` في `.env` خلف HTTPS.

**نسخ احتياطي**: كل الحالة في ملف واحد `data/namliah.db`:

```bash
# crontab -e — نسخة ليلية 4 فجراً
0 4 * * * sqlite3 /path/to/namliah-ops/data/namliah.db ".backup /backups/namliah-$(date +\%F).db"
```

---

## اختبار سريع (End-to-End)

```bash
# 1) شغّل وسجّل دخول بالدورين
npm run seed && npm start

# 2) اختبر الـ webhook
curl -s -X POST http://localhost:3000/api/webhook/sales \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{"date":"2026-07-05","summary":{"total_sales":9000,"orders_count":120},"lines":[{"product_name":"شاورما عربي","category":"ساندويشات","qty":40,"unit_price":17,"total":680}]}'
# → {"status":"created"} ثم أعد الإرسال → {"status":"updated"}
# مفتاح خاطئ → 401 · بعد الاعتماد → 409

# 3) من صفحة مدير التشغيل: احفظ ملاحظة → اعتمد → تظهر فوراً في داشبورد الإدارة
# 4) افتح /report/2026-07-05/print → طباعة / حفظ PDF
```
