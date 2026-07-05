'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'namliah.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// الفروع المدعومة — التفعيل الفعلي لفرعٍ يتم بضبط مفاتيحه في .env وإنشاء مستخدمه
const BRANCHES = { jeddah: 'جدة', abha: 'أبها', makkah: 'مكة' };
const DEFAULT_BRANCH = 'jeddah';

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ops','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY,
  branch TEXT NOT NULL DEFAULT 'jeddah',
  report_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
  total_sales REAL NOT NULL DEFAULT 0,
  orders_count INTEGER NOT NULL DEFAULT 0,
  avg_ticket REAL NOT NULL DEFAULT 0,
  payment_breakdown TEXT NOT NULL DEFAULT '{}',
  channel_breakdown TEXT NOT NULL DEFAULT '{}',
  deductions TEXT NOT NULL DEFAULT '{}',
  deduction_notes TEXT NOT NULL DEFAULT '{}',
  hall_sales TEXT NOT NULL DEFAULT '[]',
  raw_payload TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  approved_by INTEGER REFERENCES users(id),
  is_demo INTEGER NOT NULL DEFAULT 0,
  UNIQUE (branch, report_date)
);

CREATE TABLE IF NOT EXISTS sales_lines (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  category TEXT,
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  total REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_lines_report ON sales_lines(report_id);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('customers','operations','kitchen','maintenance','general')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_report ON notes(report_id);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  author_name TEXT,
  author_photo_url TEXT,
  rating INTEGER NOT NULL,
  text TEXT,
  review_date TEXT,
  photos TEXT NOT NULL DEFAULT '[]',
  owner_reply TEXT,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive','neutral','negative')),
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(review_date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  event TEXT NOT NULL,
  user_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ترقية قواعد بيانات موجودة قبل إضافة الأعمدة الجديدة (idempotent)
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumnIfMissing('daily_reports', 'deductions', "deductions TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing('daily_reports', 'hall_sales', "hall_sales TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('daily_reports', 'deduction_notes', "deduction_notes TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing('notes', 'category', "category TEXT NOT NULL DEFAULT 'general'");
addColumnIfMissing('users', 'branch', 'branch TEXT');
addColumnIfMissing('reviews', 'branch', "branch TEXT NOT NULL DEFAULT 'jeddah'");

// قاعدة قديمة بقيد UNIQUE(report_date) فقط: إعادة بناء الجدول بقيد (branch, report_date)
const oldCols = db.prepare('PRAGMA table_info(daily_reports)').all().map((c) => c.name);
const hasBranchUnique = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_reports'"
).get().sql.includes('UNIQUE (branch, report_date)');
if (oldCols.includes('branch') === false || !hasBranchUnique) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE daily_reports_new (
        id INTEGER PRIMARY KEY,
        branch TEXT NOT NULL DEFAULT 'jeddah',
        report_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
        total_sales REAL NOT NULL DEFAULT 0,
        orders_count INTEGER NOT NULL DEFAULT 0,
        avg_ticket REAL NOT NULL DEFAULT 0,
        payment_breakdown TEXT NOT NULL DEFAULT '{}',
        channel_breakdown TEXT NOT NULL DEFAULT '{}',
        deductions TEXT NOT NULL DEFAULT '{}',
        deduction_notes TEXT NOT NULL DEFAULT '{}',
        hall_sales TEXT NOT NULL DEFAULT '[]',
        raw_payload TEXT,
        received_at TEXT NOT NULL DEFAULT (datetime('now')),
        approved_at TEXT,
        approved_by INTEGER REFERENCES users(id),
        is_demo INTEGER NOT NULL DEFAULT 0,
        UNIQUE (branch, report_date)
      );
      INSERT INTO daily_reports_new
        (id, branch, report_date, status, total_sales, orders_count, avg_ticket,
         payment_breakdown, channel_breakdown, deductions, deduction_notes, hall_sales,
         raw_payload, received_at, approved_at, approved_by, is_demo)
      SELECT id, 'jeddah', report_date, status, total_sales, orders_count, avg_ticket,
         payment_breakdown, channel_breakdown, deductions, deduction_notes, hall_sales,
         raw_payload, received_at, approved_at, approved_by, is_demo
      FROM daily_reports;
      DROP TABLE daily_reports;
      ALTER TABLE daily_reports_new RENAME TO daily_reports;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

function audit(event, userId, detail) {
  db.prepare('INSERT INTO audit_log (event, user_id, detail) VALUES (?, ?, ?)').run(
    event,
    userId || null,
    detail ? JSON.stringify(detail) : null
  );
}

module.exports = { db, getSetting, setSetting, audit, BRANCHES, DEFAULT_BRANCH };
