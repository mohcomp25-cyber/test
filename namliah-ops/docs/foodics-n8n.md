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

## 3) بناء الوورك فلو في n8n

**العقد بالترتيب:**

1. **Schedule Trigger** — يومياً 01:30 فجراً بتوقيت الرياض (بعد إقفال الوردية وقبل مزامنة المراجعات).
2. **جلب الملفات الثلاثة** — بحسب طريقة وصولها:
   - إن كانت تصل بريدياً: عقدة **Gmail/IMAP** بفلتر المرسل + Attachment.
   - إن كانت من Foodics API/تصدير مجدول إلى مجلد: عقدة **HTTP Request** أو **Google Drive/FTP**.
   - المهم أن تنتهي بثلاث Binary: orders / items / payments.
3. **Extract From File** (×3) — نوع CSV، الترميز UTF-8 → يحول كل ملف إلى items.
4. **Merge** — دمج المخرجات الثلاثة في مدخل واحد لعقدة الكود (أو مررها كمدخلات متعددة).
5. **Code** — الصق دالة `transform` من `scripts/foodics-to-webhook.js` (القسم من `function transform` حتى نهايتها + دالة `num`)، ثم:
   ```js
   const orders = $input.all().filter(...); // بحسب طريقة الدمج عندك
   const payload = transform(ordersRows, itemsRows, paymentsRows, null);
   return [{ json: payload }];
   ```
   (إن استخدمت Extract From File فالصفوف تصلك جاهزة ككائنات — تجاوز parseCsv.)
6. **HTTP Request** — POST إلى:
   - URL: `https://<الدومين>/api/webhook/sales`
   - Header: `X-Webhook-Secret: {{ $env.WEBHOOK_SECRET_JEDDAH }}`
   - Body: JSON = مخرجات عقدة الكود.
7. **IF على الرد** — `200 created/updated` = نجاح. `409 report_already_approved` = اليوم معتمد (اعتبرها نجاحاً في إعادة المحاولة). غير ذلك → عقدة تنبيه (تيليجرام/بريد).

**ملاحظات تشغيلية:**
- إعادة إرسال نفس اليوم آمنة تماماً قبل الاعتماد (تحديث كامل) ومرفوضة بعده (409).
- الطلبات بعد منتصف الليل تحمل `business_date` اليوم السابق في فودكس نفسه — لا تحتاج معالجة.
- لكل فرع مفتاحه (`WEBHOOK_SECRET_ABHA`…) — انسخ الوورك فلو وغيّر المفتاح فقط.

---

## 4) بيانات إضافية متاحة في الملفات (غير مستغلة بعد)

- **عدد الضيوف** (`guests`) — يتيح متوسط إنفاق الضيف.
- **زمن التجهيز** (`preparation_period` / kitchen_received/done) — متوسط زمن المطبخ ومراقبة الذروة.
- **الإكراميات** (`tips`).
- **مصدر الطلب** (`source`: Cashier/API).
اطلبها متى أردت إضافتها للمنصة.
