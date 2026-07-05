'use strict';
// بيانات تجريبية: مستخدمان + ٣٠ يوم مبيعات واقعية + مراجعات قوقل ماب تجريبية
// كل صفوف العرض التجريبي معلّمة is_demo=1 — امسحها لاحقاً بـ: npm run wipe-demo
require('dotenv').config();
const { db } = require('../src/db');
const { hashPassword } = require('../src/auth');

// ---- users ----
// جدة هي الفرع المفعّل حالياً — أبها ومكة يضافان عند الافتتاح عبر scripts/add-user.js
const USERS = [
  { username: 'ops', display_name: 'مدير تشغيل فرع جدة', role: 'ops', branch: 'jeddah', password: 'namliah-ops-2026' },
  { username: 'admin', display_name: 'الإدارة', role: 'admin', branch: null, password: 'namliah-admin-2026' }
];
const insUser = db.prepare(
  'INSERT OR IGNORE INTO users (username, display_name, password_hash, role, branch) VALUES (?, ?, ?, ?, ?)'
);
for (const u of USERS) insUser.run(u.username, u.display_name, hashPassword(u.password), u.role, u.branch);
const opsUser = db.prepare("SELECT id FROM users WHERE username = 'ops'").get();

// ---- menu (لبناني) ----
const MENU = [
  { name: 'شاورما عربي', cat: 'ساندويشات', price: 17 },
  { name: 'شاورما صحن', cat: 'مشاوي', price: 32 },
  { name: 'مشاوي مشكل', cat: 'مشاوي', price: 68 },
  { name: 'شيش طاووق', cat: 'مشاوي', price: 42 },
  { name: 'كباب حلبي', cat: 'مشاوي', price: 45 },
  { name: 'حمص', cat: 'مقبلات', price: 14 },
  { name: 'متبل باذنجان', cat: 'مقبلات', price: 15 },
  { name: 'تبولة', cat: 'مقبلات', price: 16 },
  { name: 'فتوش', cat: 'مقبلات', price: 17 },
  { name: 'ورق عنب', cat: 'مقبلات', price: 22 },
  { name: 'فطاير جبنة', cat: 'معجنات', price: 12 },
  { name: 'مناقيش زعتر', cat: 'معجنات', price: 10 },
  { name: 'كنافة نابلسية', cat: 'حلويات', price: 24 },
  { name: 'مهلبية', cat: 'حلويات', price: 12 },
  { name: 'عصير ليمون بالنعناع', cat: 'مشروبات', price: 11 },
  { name: 'جلاب', cat: 'مشروبات', price: 13 }
];

// mulberry32 — عشوائية ثابتة البذرة حتى تكون البيانات قابلة للتكرار
let seed = 20260705;
function rand() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const insReport = db.prepare(`
  INSERT OR IGNORE INTO daily_reports
    (branch, report_date, status, total_sales, orders_count, avg_ticket, payment_breakdown, channel_breakdown, deductions, deduction_notes, hall_sales, hourly_sales, first_order_at, last_order_at, approved_at, approved_by, is_demo)
  VALUES ('jeddah', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
`);
const insLine = db.prepare(
  'INSERT INTO sales_lines (report_id, product_name, category, qty, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)'
);
const insNote = db.prepare('INSERT INTO notes (report_id, author_id, category, body) VALUES (?, ?, ?, ?)');

const WAITERS = ['جورج', 'إيلي', 'طوني', 'مروان', 'شربل'];

const NOTES_BY_CATEGORY = {
  customers: [
    'شكوى عميل على مدة تجهيز المشاوي وقت الذروة — تم الاعتذار وتقديم حلى مجاني، والعميل غادر راضياً.',
    'عميلة طلبت خيارات خالية من الغلوتين — تم توجيهها للأصناف المناسبة وأوصينا المطبخ بإضافة ملصق توضيحي.',
    'طاولة عائلية أثنت على الخدمة وطلبت التواصل مع الإدارة للشكر.'
  ],
  operations: [
    'ضغط عالٍ وقت العشاء — نحتاج كاشير إضافي نهاية الأسبوع.',
    'تم تدريب موظف الاستقبال الجديد على نظام الطلبات.',
    'حملة تطبيقات التوصيل رفعت الطلبات بشكل ملحوظ اليوم.'
  ],
  kitchen: [
    'تأخر مورد الخضار ساعتين — تمت معالجة النقص من المستودع.',
    'استهلاك زيت القلي أعلى من المعتاد، تمت جدولة مراجعة للمقادير.',
    'تجهيز مسبق ناجح لكميات الحمص والمتبل قلل زمن الانتظار.'
  ],
  maintenance: [
    'صيانة دورية للشواية الرئيسية بعد الإغلاق.',
    'انقطاع كهرباء قصير (١٠ دقائق) — المولد الاحتياطي عمل بشكل سليم.',
    'تم إصلاح تسريب بسيط في مغسلة المطبخ.'
  ],
  general: [
    'يوم هادئ نسبياً بشكل عام.',
    'زيارة تفتيشية من البلدية — لا ملاحظات.',
    'اجتماع قصير مع الفريق قبل الوردية لمراجعة أهداف الأسبوع.'
  ]
};

// عدد طاولات الصالة الافتراضي (يعدّله مدير التشغيل من المنصة)
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tables_count:jeddah', '14')").run();

const today = new Date(Date.now() + 3 * 3600 * 1000); // Asia/Riyadh
let created = 0;

const seedTx = db.transaction(() => {
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay(); // 4=خميس 5=جمعة 6=سبت — ذروة نهاية الأسبوع
    const weekendBoost = (dow === 4 || dow === 5 || dow === 6) ? 1.35 : 1;

    const lines = [];
    let total = 0;
    for (const item of MENU) {
      const baseQty = 6 + Math.floor(rand() * 30);
      const qty = Math.max(1, Math.round(baseQty * weekendBoost * (0.7 + rand() * 0.6)));
      const lineTotal = +(qty * item.price).toFixed(2);
      lines.push({ ...item, qty, total: lineTotal });
      total += lineTotal;
    }
    total = +total.toFixed(2);
    const orders = Math.round(total / (55 + rand() * 25));
    const avg = +(total / orders).toFixed(2);

    const cash = +(total * (0.12 + rand() * 0.08)).toFixed(2);
    const online = +(total * (0.2 + rand() * 0.1)).toFixed(2);
    const card = +(total - cash - online).toFixed(2);

    // الطلبات الخارجية = استلام فقط، والباقي مبيعات صالة موزعة على الويترز
    const takeaway = +(total * (0.18 + rand() * 0.08)).toFixed(2);
    const hallTotal = +(total - takeaway).toFixed(2);

    const weights = WAITERS.map(() => 0.6 + rand());
    const wSum = weights.reduce((a, b) => a + b, 0);
    let allocated = 0;
    const hallSales = WAITERS.map((w, wi) => {
      const share = wi === WAITERS.length - 1
        ? +(hallTotal - allocated).toFixed(2)
        : +((hallTotal * weights[wi]) / wSum).toFixed(2);
      allocated = +(allocated + share).toFixed(2);
      return { waiter: w, total: share };
    });

    const deductions = {
      coupons: +(total * (0.01 + rand() * 0.02)).toFixed(2),
      discounts: +(total * (0.005 + rand() * 0.015)).toFixed(2),
      cancellations: +(total * (rand() * 0.01)).toFixed(2)
    };
    const DEDUCTION_NOTE_SAMPLES = {
      coupons: ['٣ بلوقر', 'حملة تيك توك', 'كوبونات افتتاح'],
      discounts: ['خصم للمالك', 'خصم موظفين', 'ضيافة شركاء'],
      cancellations: ['إرجاع طلب فيه مشكلة', 'إلغاء طاولة حجز مزدوج', 'خطأ إدخال كاشير']
    };
    const deductionNotes = {};
    for (const [key, pool] of Object.entries(DEDUCTION_NOTE_SAMPLES)) {
      if (rand() < 0.5) deductionNotes[key] = pool[Math.floor(rand() * pool.length)];
    }

    // المبيعات بالساعة: عمل من ١٢ ظهراً حتى ١١ ليلاً بذروتي غداء وعشاء
    const HOUR_WEIGHTS = { 12: 0.5, 13: 1.0, 14: 1.1, 15: 0.7, 16: 0.35, 17: 0.35, 18: 0.6, 19: 1.0, 20: 1.35, 21: 1.5, 22: 1.05, 23: 0.5 };
    const wTotal = Object.values(HOUR_WEIGHTS).reduce((a, b) => a + b, 0);
    let hAllocated = 0;
    let oAllocated = 0;
    const hourEntries = Object.entries(HOUR_WEIGHTS);
    const hourlySales = hourEntries.map(([hourStr, weight], hi) => {
      const hour = Number(hourStr);
      const jitter = 0.8 + rand() * 0.4;
      const isLast = hi === hourEntries.length - 1;
      const hTotal = isLast ? +(total - hAllocated).toFixed(2) : +((total * weight * jitter) / wTotal).toFixed(2);
      const hOrders = isLast ? Math.max(1, orders - oAllocated) : Math.max(1, Math.round((orders * weight) / wTotal));
      hAllocated = +(hAllocated + hTotal).toFixed(2);
      oAllocated += hOrders;
      return { hour, total: hTotal, orders: hOrders };
    });
    const firstOrderAt = `12:${String(Math.floor(rand() * 20)).padStart(2, '0')}`;
    const lastOrderAt = `23:${String(30 + Math.floor(rand() * 25)).padStart(2, '0')}`;

    const approved = i >= 2; // آخر يومين pending لتجربة الاعتماد
    const info = insReport.run(
      date,
      approved ? 'approved' : 'pending',
      total, orders, avg,
      JSON.stringify({ cash, card, online }),
      JSON.stringify({ takeaway }),
      JSON.stringify(deductions),
      JSON.stringify(deductionNotes),
      JSON.stringify(hallSales),
      JSON.stringify(hourlySales),
      firstOrderAt,
      lastOrderAt,
      approved ? `${date} 23:45:00` : null,
      approved ? opsUser.id : null
    );
    if (info.changes === 0) continue; // اليوم موجود مسبقاً — لا نكرر
    created++;
    const reportId = info.lastInsertRowid;
    for (const l of lines) insLine.run(reportId, l.name, l.cat, l.qty, l.price, l.total);
    for (const [cat, pool] of Object.entries(NOTES_BY_CATEGORY)) {
      if (rand() < 0.45) insNote.run(reportId, opsUser.id, cat, pool[Math.floor(rand() * pool.length)]);
    }
  }
});
seedTx();

// ---- demo reviews ----
const REVIEWS = [
  { r: 5, a: 'عبدالله السلمي', t: 'أكل لبناني أصيل، الشاورما من أفضل ما جربت في جدة. الخدمة سريعة والمكان نظيف.', photos: 2 },
  { r: 5, a: 'ريم الحربي', t: 'المشاوي ممتازة والتبولة طازجة جداً. أنصح بالكنافة النابلسية!', photos: 1 },
  { r: 4, a: 'محمد الغامدي', t: 'تجربة جميلة، الأسعار مناسبة. تأخر الطلب قليلاً وقت الذروة.', photos: 0 },
  { r: 5, a: 'سارة العتيبي', t: 'أجواء المكان رائعة وتصميمه تراثي جميل. ورق العنب يستحق التجربة.', photos: 3 },
  { r: 2, a: 'خالد المطيري', t: 'الطلب وصل بارد عبر التوصيل والانتظار طويل. أتمنى تحسين التغليف.', photos: 0, reply: 'نعتذر عن التجربة، تواصلنا معك وتم تعويضك. حرصنا على تحسين تغليف طلبات التوصيل.' },
  { r: 5, a: 'نورة القحطاني', t: 'من أفضل المطاعم اللبنانية، الحمص والمتبل ولا أطيب. الموظفون ودودون.', photos: 1 },
  { r: 3, a: 'فهد الزهراني', t: 'الأكل جيد لكن المكان كان مزدحماً ولم نجد طاولة إلا بعد انتظار.', photos: 0 },
  { r: 4, a: 'لطيفة الشهري', t: 'شيش طاووق لذيذ وعصير الليمون بالنعناع منعش. التقييم ٤ بسبب الموقف الضيق للسيارات.', photos: 1 },
  { r: 1, a: 'بدر العنزي', t: 'طلبي عبر التطبيق وصل ناقصاً ولم يتم الرد على اتصالي إلا متأخراً.', photos: 0, reply: 'نأسف جداً، تم استرداد قيمة الأصناف الناقصة وتدريب الفريق على مراجعة الطلبات قبل التسليم.' },
  { r: 5, a: 'هند باوزير', t: 'فطور الجمعة عندهم تجربة عائلية ممتازة، المناقيش على أصولها.', photos: 2 },
  { r: 4, a: 'تركي الدوسري', t: 'جودة ثابتة في كل زيارة. أتمنى إضافة أصناف حلويات أكثر.', photos: 0 },
  { r: 5, a: 'أمل جمال', t: 'الكباب الحلبي تحفة! والتقديم أنيق جداً. يستاهل ٥ نجوم.', photos: 1 }
];
const insReview = db.prepare(`
  INSERT OR IGNORE INTO reviews
    (external_id, branch, author_name, rating, text, review_date, photos, owner_reply, sentiment, is_demo)
  VALUES (?, 'jeddah', ?, ?, ?, ?, ?, ?, ?, 1)
`);
let reviewsCreated = 0;
REVIEWS.forEach((rv, i) => {
  const d = new Date(today.getTime() - (i * 2 + 1) * 86400000).toISOString().slice(0, 10);
  const photos = Array.from({ length: rv.photos }, (_, p) =>
    `https://picsum.photos/seed/namliah-${i}-${p}/400/300`
  );
  const sentiment = rv.r >= 4 ? 'positive' : rv.r <= 2 ? 'negative' : 'neutral';
  const info = insReview.run(`demo-${i}`, rv.a, rv.r, rv.t, d, JSON.stringify(photos), rv.reply || null, sentiment);
  reviewsCreated += info.changes;
});

console.log(`✔ البذر اكتمل: ${created} يوم مبيعات جديد، ${reviewsCreated} مراجعة تجريبية.`);
console.log('  الدخول: ops / namliah-ops-2026 (مدير تشغيل فرع جدة) — admin / namliah-admin-2026 (الإدارة)');
console.log('  لإضافة مدير فرع جديد: node scripts/add-user.js <username> <password> ops <abha|makkah>');
console.log('  ملاحظة: غيّر كلمات المرور من داخل المنصة، وامسح البيانات التجريبية بـ npm run wipe-demo');
