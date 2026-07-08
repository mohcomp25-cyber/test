# ربط فودكس بمنصة نملية — دليل الوورك فلو (n8n)

فودكس يصدّر يومياً ثلاثة ملفات CSV، ومنها تُبنى حمولة الـ webhook كاملة. هذا الدليل يوثق بنية الملفات، والمطابقة حقلاً بحقل، وخطوات بناء الوورك فلو في n8n.

> منطق التحويل الرسمي (نفسه المستخدم في عقدة Code): `scripts/foodics-to-webhook.js` — يعمل أيضاً كأداة يدوية:
> ```bash
> node scripts/foodics-to-webhook.js --orders orders.csv --items items.csv --payments payments.csv \
>   --post https://ops.namliah.example.com --secret $WEBHOOK_SECRET_JEDDAH
> ```

---

## 1) الملفات الثلاثة

### أ. ملف الطلبات (Orders)
| عمود | المعنى | استخدامه في المنصة |
|---|---|---|
| `reference` | رقم الطلب | الربط بين الملفات الثلاثة |
| `business_date` | يوم العمل | `date` (الطلبات بعد منتصف الليل تبقى محسوبة على يومها) |
| `status` | Done / Declined … | **Done فقط** يدخل في المبيعات؛ غير Done → قيمته تُحسب ضمن الإلغاءات |
| `type` | Dine In / To Go … | Dine In → مبيعات الصالة؛ غير ذلك → استلام |
| `total_price` | إجمالي الطلب شامل الضريبة | `total_sales` (مجموع Done) |
| `coupon_code` + `discounts` | كوبون وقيمته | `deductions.coupons` |
| `discount_name` + `discounts` | خصم غير كوبون | `deductions.discounts` |
| `closed_by` | الموظف الذي أقفل الطلب | `hall_sales` (توزيع الصالة بالموظف) |
| `created_at` | وقت إنشاء الطلب | `hourly_sales` + `first_order_at` + `last_order_at` |
| `guests` | عدد الضيوف | غير مستخدم حالياً (متاح مستقبلاً) |
| `preparation_period` | زمن التجهيز | غير مستخدم حالياً (متاح: متوسط زمن المطبخ) |

### ب. ملف الأصناف (Order items)
| عمود | المعنى | استخدامه |
|---|---|---|
| `order_reference` / `order_status` | الطلب وحالته | استبعاد أصناف الطلبات غير المكتملة |
| `status` | Done / **Void** | Void → قيمته تُضاف إلى `deductions.cancellations` |
| `type` | Product / Modifier Option | Product فقط يدخل تفاصيل الأصناف |
| `name` | «عربي - english» | `lines[].product_name` (يُؤخذ الجزء العربي قبل «-») |
| `quantity` / `unit_price` / `total_price` | الكمية والأسعار | `lines[].qty / unit_price / total` (تجميع بالاسم) |
| `discount_amount` | خصم على الصنف | يُضاف إلى `deductions.discounts` إن وجد |

لا يوجد عمود تصنيف (category) في التصدير — `category` تُترك فارغة. (تحسين مستقبلي: جدول ربط SKU → تصنيف.)

### ج. ملف الدفعات (Payments)
| عمود | المعنى | استخدامه |
|---|---|---|
| `order_reference` | الطلب | استبعاد دفعات الطلبات غير المكتملة (مثل Declined) |
| `payment_method_name` | Card / Cash - كاش / Qlub / QlubQSR | `payment_breakdown`: Card→`card`، Cash→`cash`، Qlub+QlubQSR→`qlub` |
| `amount` | المبلغ | مجموع لكل طريقة |
| `employee_name` | الكاشير | (التوزيع يُؤخذ من closed_by في الطلبات — أدق) |
| `tips` | إكراميات | غير مستخدمة حالياً |

**فحص تطابق مدمج:** مجموع الدفعات (للطلبات المكتملة) يجب أن يساوي مجموع الطلبات المكتملة — في عينة 2026-07-05: **30,021 = 30,021** ✔

---

## 2) خريطة الحمولة النهائية

```
date                    = business_date
total_sales             = Σ orders.total_price حيث status=Done
orders_count            = عدد الطلبات Done
deductions.coupons      = Σ orders.discounts حيث يوجد coupon_code
deductions.discounts    = Σ orders.discounts (بدون كوبون) + Σ items.discount_amount
deductions.cancellations= Σ items.total_price حيث status=Void + Σ orders.total_price حيث status≠Done
payment_breakdown       = Σ payments.amount لكل طريقة (Done فقط): card / cash / qlub
hall_sales              = Σ orders.total_price (Done, Dine In) مجمعة بـ closed_by
external_sales.takeaway = Σ orders.total_price (Done, type≠Dine In)
hourly_sales            = تجميع الطلبات Done بساعة created_at: {hour, total, orders}
first_order_at          = أول created_at · last_order_at = آخر created_at (HH:MM)
lines                   = أصناف Done من طلبات Done مجمعة بالاسم العربي، مرتبة تنازلياً
```

---

## 3) بناء الوورك فلو في n8n (متعدد الفروع)

الملفات الثلاثة **مدموجة تحتوي كل الفروع** (عمود `branch_name`: Jeddah / Abha…). الوورك فلو يقسّمها تلقائياً ويرسل كل فرع لمفتاحه.

**العقد بالترتيب:**

1. **Schedule Trigger** — يومياً بعد نزول الملفات (مثلاً 04:30 فجراً بتوقيت الرياض).
2. **جلب الملفات الثلاثة** حيث تنزل (Google Drive / بريد / FTP) → ثلاث Binary: orders / items / payments.
3. **Extract From File** (×3) — CSV، UTF-8 → صفوف ككائنات.
4. **Code** — الصق **كامل** `scripts/foodics-to-webhook.js` (كل الدوال: `num`، `transform`، `branchKey`، `transformByBranch`)، ثم في النهاية:
   ```js
   const orders   = $('Extract Orders').all().map(i => i.json);
   const items    = $('Extract Items').all().map(i => i.json);
   const payments = $('Extract Payments').all().map(i => i.json);
   // يقسّم حسب الفرع ويعيد [{ key, name, payload }]
   return transformByBranch(orders, items, payments, null)
     .filter(g => g.payload.summary.orders_count > 0)
     .map(g => ({ json: { branch: g.key, ...g.payload } }));
   ```
   (تجاوز `parseCsv` — الصفوف تصل جاهزة من Extract From File.)
5. **HTTP Request** (يعمل لكل عنصر = لكل فرع):
   - URL: `https://<الدومين>/api/webhook/sales`
   - Header: `X-Webhook-Secret: {{ $json.branch === 'abha' ? $env.WEBHOOK_SECRET_ABHA : $env.WEBHOOK_SECRET_JEDDAH }}`
   - Body: JSON = `{{ $json }}` (بعد حذف حقل branch إن أردت، أو اتركه — المنصة تتجاهله وتعتمد الفرع من المفتاح).
   - Settings → Continue On Fail = true (حتى لا يوقف فرعٌ بقية الفروع).
6. **IF على الرد** — `200` نجاح · `409` اليوم معتمد (اعتبرها نجاحاً) · غير ذلك → تنبيه.

**بديل أبسط بدون Code node:** شغّل السكربت مباشرة على السيرفر عبر عقدة **Execute Command**:
```
cd /opt/namliah-ops && node scripts/foodics-to-webhook.js \
  --orders /path/orders.csv --items /path/items.csv --payments /path/payments.csv \
  --post http://127.0.0.1:3000
```
السكربت يقرأ `WEBHOOK_SECRET_JEDDAH`/`_ABHA` من `.env` تلقائياً ويرسل كل فرع لمفتاحه.

**ملاحظات تشغيلية:**
- إعادة إرسال نفس اليوم آمنة قبل الاعتماد (تحديث كامل) ومرفوضة بعده (409).
- الطلبات بعد منتصف الليل تحمل `business_date` اليوم السابق في فودكس نفسه — لا معالجة إضافية.
- إضافة فرع جديد لاحقاً: يكفي أن يظهر `branch_name` في الملف + مفتاحه في `.env` — لا تعديل على الوورك فلو.

---

## 4) بيانات إضافية متاحة في الملفات (غير مستغلة بعد)

- **عدد الضيوف** (`guests`) — يتيح متوسط إنفاق الضيف.
- **زمن التجهيز** (`preparation_period` / kitchen_received/done) — متوسط زمن المطبخ ومراقبة الذروة.
- **الإكراميات** (`tips`).
- **مصدر الطلب** (`source`: Cashier/API).
اطلبها متى أردت إضافتها للمنصة.
