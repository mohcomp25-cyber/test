'use strict';
// مسح كل البيانات التجريبية (is_demo=1) — شغّله عند تفعيل الوورك فلو الحقيقي
require('dotenv').config();
const { db } = require('../src/db');

const tx = db.transaction(() => {
  const reports = db.prepare('DELETE FROM daily_reports WHERE is_demo = 1').run();
  const reviews = db.prepare('DELETE FROM reviews WHERE is_demo = 1').run();
  return { reports: reports.changes, reviews: reviews.changes };
});
const result = tx();
console.log(`✔ تم مسح ${result.reports} تقرير تجريبي (مع تفاصيله وملاحظاته) و ${result.reviews} مراجعة تجريبية.`);
