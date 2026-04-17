import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const DB_PATH = new URL('../data/app.db', import.meta.url).pathname;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    goal TEXT,
    location TEXT,
    start_date TEXT,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS time_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    slot_datetime TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    slot_id INTEGER REFERENCES time_slots(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    tiktok_username TEXT NOT NULL,
    followers_count INTEGER,
    whatsapp_number TEXT NOT NULL,
    city TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    responded_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_slots_campaign ON time_slots(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_reg_campaign ON registrations(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
`);

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function ensureDefaultAdmin() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM admin_users').get();
  if (row.c === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)')
      .run(username, hashPassword(password));
    console.log(`[db] Default admin created: ${username} / ${password}`);
  }
}

export function slotAvailableCount(slotId) {
  const slot = db.prepare('SELECT capacity FROM time_slots WHERE id = ?').get(slotId);
  if (!slot) return 0;
  const taken = db.prepare(
    "SELECT COUNT(*) AS c FROM registrations WHERE slot_id = ? AND status IN ('pending','approved')"
  ).get(slotId).c;
  return Math.max(0, slot.capacity - taken);
}
