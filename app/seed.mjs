import { db, ensureDefaultAdmin } from './lib/db.mjs';

ensureDefaultAdmin();

// امسح البيانات القديمة (الحملات + المواعيد + السجلات)
db.exec('DELETE FROM registrations; DELETE FROM time_slots; DELETE FROM campaigns;');

const addCampaign = db.prepare(`
  INSERT INTO campaigns (slug, title, description, goal, location, start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const addSlot = db.prepare('INSERT INTO time_slots (campaign_id, slot_datetime, capacity) VALUES (?, ?, ?)');

const today = new Date();
const in3 = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
const in10 = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);
const in20 = new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000);

const c1 = addCampaign.run(
  'riyadh-boulevard-2026',
  'افتتاح بوليفارد الرياض — موسم 2026',
  'حملة تغطية لافتتاح ساحة بوليفارد الرياض، نحتاج بلوقرز لتغطية الفعالية وتجربة الأنشطة.',
  'تغطية افتتاح الساحة ونشر 3 محتويات خلال اليوم',
  'الرياض — بوليفارد',
  today.toISOString().slice(0, 10),
  in20.toISOString().slice(0, 10),
  'active'
).lastInsertRowid;

for (const h of [18, 19, 20, 21]) {
  const d = new Date(in3); d.setHours(h, 0, 0, 0);
  addSlot.run(c1, d.toISOString(), 3);
}

const c2 = addCampaign.run(
  'jeddah-corniche-summer',
  'كرنفال كورنيش جدة الصيفي',
  'فعالية صيفية على كورنيش جدة تتضمن عروض وأنشطة عائلية.',
  'دعوة بلوقرز للتغطية الحية على تيك توك',
  'جدة — الكورنيش',
  in10.toISOString().slice(0, 10),
  in20.toISOString().slice(0, 10),
  'active'
).lastInsertRowid;

for (const h of [17, 18, 19]) {
  const d = new Date(in10); d.setHours(h, 0, 0, 0);
  addSlot.run(c2, d.toISOString(), 2);
}

const c3 = addCampaign.run(
  'khobar-mall-launch',
  'افتتاح فرع الخبر (مغلقة)',
  'مثال لحملة مغلقة.',
  'تجربة نظام الحالة المغلقة',
  'الخبر',
  null, null, 'closed'
).lastInsertRowid;

console.log('تم زرع البيانات التجريبية:');
console.log(` - حملة مفتوحة: riyadh-boulevard-2026 (4 مواعيد)`);
console.log(` - حملة مفتوحة: jeddah-corniche-summer (3 مواعيد)`);
console.log(` - حملة مغلقة:  khobar-mall-launch`);
console.log('\nبيانات الدخول الافتراضية: admin / admin123');
