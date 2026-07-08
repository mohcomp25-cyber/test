'use strict';
// إضافة مستخدم جديد — مثال عند افتتاح فرع:
//   node scripts/add-user.js abha_manager "كلمة-مرور-قوية" ops abha
require('dotenv').config();
const { db, BRANCHES } = require('../src/db');
const { hashPassword } = require('../src/auth');

const [username, password, role, branch] = process.argv.slice(2);

if (!username || !password || !['ops', 'admin'].includes(role)) {
  console.log('الاستخدام: node scripts/add-user.js <username> <password> <ops|admin> [branch]');
  console.log(`الفروع المتاحة: ${Object.keys(BRANCHES).join(' | ')}`);
  process.exit(1);
}
if (role === 'ops' && !BRANCHES[branch]) {
  console.error(`مدير التشغيل يحتاج فرعاً صحيحاً: ${Object.keys(BRANCHES).join(' | ')}`);
  process.exit(1);
}
if (String(password).length < 8) {
  console.error('كلمة المرور يجب أن تكون ٨ أحرف على الأقل');
  process.exit(1);
}

const displayName = role === 'ops' ? `مدير تشغيل فرع ${BRANCHES[branch]}` : 'الإدارة';
try {
  db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role, branch) VALUES (?, ?, ?, ?, ?)'
  ).run(String(username).trim().toLowerCase(), displayName, hashPassword(String(password)), role, role === 'ops' ? branch : null);
  console.log(`تم إنشاء المستخدم: ${username} (${displayName})`);
  if (role === 'ops') {
    console.log(`لا تنسَ ضبط مفاتيح الفرع في .env: WEBHOOK_SECRET_${branch.toUpperCase()} و GOOGLE_MAPS_URL_${branch.toUpperCase()}`);
  }
} catch (err) {
  console.error(err.message.includes('UNIQUE') ? 'اسم المستخدم موجود مسبقاً' : err.message);
  process.exit(1);
}
