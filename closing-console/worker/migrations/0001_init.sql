-- Daily Closing Console — initial schema.
-- Money columns end with `_h` and store INTEGER halalas (SAR * 100).
-- Dates: business_date is TEXT 'YYYY-MM-DD' (Asia/Riyadh). Timestamps are TEXT ISO-8601 UTC.

PRAGMA foreign_keys = ON;

CREATE TABLE accountants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at   TEXT,
  disabled        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE brands (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  accountant_id   INTEGER NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'restaurant',
  currency        TEXT NOT NULL DEFAULT 'SAR',
  timezone        TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_brands_accountant ON brands(accountant_id);

CREATE TABLE branches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id        INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_branches_brand ON branches(brand_id);

CREATE TABLE branch_settings (
  branch_id              INTEGER PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  require_cash_photo     INTEGER NOT NULL DEFAULT 1,
  require_network_photo  INTEGER NOT NULL DEFAULT 1,
  require_apps_photo     INTEGER NOT NULL DEFAULT 1,
  require_expense_receipt INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE safes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id          INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  opening_balance_h  INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_safes_branch ON safes(branch_id);

CREATE TABLE employees (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id           INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  branch_id          INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  phone              TEXT,
  custody_balance_h  INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_employees_brand ON employees(brand_id);
CREATE INDEX idx_employees_branch ON employees(branch_id);

CREATE TABLE cashier_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id        INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  branch_id       INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  safe_id         INTEGER NOT NULL REFERENCES safes(id) ON DELETE CASCADE,
  employee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  token           TEXT NOT NULL UNIQUE,
  pin_hash        TEXT NOT NULL,
  pin_version     INTEGER NOT NULL DEFAULT 1,
  label           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at      TEXT,
  last_used_at    TEXT
);
CREATE INDEX idx_links_brand ON cashier_links(brand_id);
CREATE INDEX idx_links_branch ON cashier_links(branch_id);
CREATE INDEX idx_links_safe ON cashier_links(safe_id);

CREATE TABLE closings (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id                 INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  branch_id                INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  safe_id                  INTEGER NOT NULL REFERENCES safes(id) ON DELETE CASCADE,
  employee_id              INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  cashier_link_id          INTEGER NOT NULL REFERENCES cashier_links(id) ON DELETE RESTRICT,
  business_date            TEXT NOT NULL,
  shift                    TEXT,
  total_shift_sales_h      INTEGER NOT NULL,
  network_sales_h          INTEGER NOT NULL,
  apps_sales_h             INTEGER NOT NULL,
  apps_invoice_count       INTEGER NOT NULL DEFAULT 0,
  cash_sales_h             INTEGER NOT NULL,
  cash_in_safe_h           INTEGER NOT NULL,
  cash_custody_h           INTEGER NOT NULL DEFAULT 0,
  custody_expenses_h       INTEGER NOT NULL DEFAULT 0,
  custody_expenses_note    TEXT,
  opening_cash_in_safe_h   INTEGER NOT NULL,
  expected_cash_h          INTEGER NOT NULL,
  discrepancy_h            INTEGER NOT NULL,
  notes                    TEXT,
  status                   TEXT NOT NULL DEFAULT 'submitted',
  submitted_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  submitted_ip             TEXT,
  confirmed_at             TEXT,
  confirmed_by             INTEGER REFERENCES accountants(id) ON DELETE SET NULL,
  reject_reason            TEXT
);
CREATE INDEX idx_closings_brand_date ON closings(brand_id, business_date);
CREATE INDEX idx_closings_safe_date ON closings(safe_id, business_date);
CREATE INDEX idx_closings_branch_date ON closings(branch_id, business_date);
CREATE INDEX idx_closings_employee ON closings(employee_id);
CREATE INDEX idx_closings_status ON closings(status);

CREATE TABLE attachments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  closing_id        INTEGER REFERENCES closings(id) ON DELETE CASCADE,
  deposit_id        INTEGER REFERENCES bank_deposits(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  r2_key            TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by_kind   TEXT NOT NULL,
  created_by_id     INTEGER NOT NULL,
  CHECK ((closing_id IS NOT NULL AND deposit_id IS NULL)
      OR (closing_id IS NULL AND deposit_id IS NOT NULL))
);
CREATE INDEX idx_attachments_closing ON attachments(closing_id);
CREATE INDEX idx_attachments_deposit ON attachments(deposit_id);

CREATE TABLE bank_deposits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  safe_id         INTEGER NOT NULL REFERENCES safes(id) ON DELETE CASCADE,
  brand_id        INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  branch_id       INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  amount_h        INTEGER NOT NULL,
  business_date   TEXT NOT NULL,
  bank_name       TEXT,
  reference       TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by      INTEGER REFERENCES accountants(id) ON DELETE SET NULL
);
CREATE INDEX idx_deposits_safe_date ON bank_deposits(safe_id, business_date);
CREATE INDEX idx_deposits_brand_date ON bank_deposits(brand_id, business_date);

CREATE TABLE cash_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  safe_id         INTEGER NOT NULL REFERENCES safes(id) ON DELETE CASCADE,
  business_date   TEXT NOT NULL,
  kind            TEXT NOT NULL,
  amount_h        INTEGER NOT NULL,
  ref_table       TEXT,
  ref_id          INTEGER,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by      INTEGER REFERENCES accountants(id) ON DELETE SET NULL
);
CREATE INDEX idx_cash_safe_date ON cash_movements(safe_id, business_date);

CREATE TABLE custody_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  business_date   TEXT NOT NULL,
  kind            TEXT NOT NULL,
  amount_h        INTEGER NOT NULL,
  ref_table       TEXT,
  ref_id          INTEGER,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by      INTEGER REFERENCES accountants(id) ON DELETE SET NULL
);
CREATE INDEX idx_custody_employee_date ON custody_movements(employee_id, business_date);

CREATE TABLE pin_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT NOT NULL,
  ip          TEXT,
  success     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_pin_attempts_token_time ON pin_attempts(token, created_at);
CREATE INDEX idx_pin_attempts_ip_time ON pin_attempts(ip, created_at);

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_kind      TEXT NOT NULL,
  actor_id        INTEGER,
  action          TEXT NOT NULL,
  entity_table    TEXT,
  entity_id       INTEGER,
  meta_json       TEXT,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
