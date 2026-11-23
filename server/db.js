// SQLite via Node's built-in driver: zero native dependencies, one file on disk.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku         TEXT UNIQUE,
  barcode     TEXT UNIQUE,
  name        TEXT NOT NULL CHECK (length(name) > 0),
  category    TEXT NOT NULL DEFAULT 'General',
  price       INTEGER NOT NULL CHECK (price >= 0),
  cost        INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
  tax_rate    REAL,
  stock       REAL,
  unit        TEXT NOT NULL DEFAULT 'pc',
  emoji       TEXT,
  color       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);

CREATE TABLE IF NOT EXISTS sales (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no      TEXT NOT NULL UNIQUE,
  fiscal_year     TEXT NOT NULL,
  bs_date         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','paid','void')),
  customer_name   TEXT,
  customer_pan    TEXT,
  customer_phone  TEXT,
  customer_email  TEXT,
  subtotal        INTEGER NOT NULL,
  discount        INTEGER NOT NULL,
  service_charge  INTEGER NOT NULL,
  taxable         INTEGER NOT NULL,
  exempt          INTEGER NOT NULL,
  tax             INTEGER NOT NULL,
  total           INTEGER NOT NULL,
  paid            INTEGER NOT NULL DEFAULT 0,
  change_due      INTEGER NOT NULL DEFAULT 0,
  payment_method  TEXT,
  notes           TEXT,
  public_token    TEXT NOT NULL UNIQUE,
  ird_status      TEXT NOT NULL DEFAULT 'off' CHECK (ird_status IN ('off','pending','synced','failed','returned')),
  ird_response    TEXT,
  void_reason     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

CREATE TABLE IF NOT EXISTS sale_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES items(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  qty         REAL NOT NULL,
  unit_price  INTEGER NOT NULL,
  discount    INTEGER NOT NULL,
  tax_rate    REAL NOT NULL,
  tax         INTEGER NOT NULL,
  total       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_item ON sale_items(item_id);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id      INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method       TEXT NOT NULL,
  amount       INTEGER NOT NULL CHECK (amount > 0),
  tendered     INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('pending','verified','failed','cancelled')),
  reference    TEXT,
  provider_ref TEXT,
  pay_url      TEXT,
  detail       TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  verified_at  TEXT,
  UNIQUE (method, provider_ref)
);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL,
  hash        TEXT NOT NULL UNIQUE,
  scopes      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used   TEXT,
  revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS webhooks_out (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL,
  events      TEXT NOT NULL,
  secret      TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  last_status TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS extensions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  code        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS membership_plans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE CHECK (length(name) > 0),
  discount_percent  REAL NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  points_multiplier REAL NOT NULL DEFAULT 1 CHECK (points_multiplier >= 0),
  fee               INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  duration_days     INTEGER NOT NULL DEFAULT 365 CHECK (duration_days >= 0),
  color             TEXT,
  perks             TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL CHECK (length(name) > 0),
  phone        TEXT UNIQUE,
  email        TEXT,
  pan          TEXT,
  points       INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  total_spent  INTEGER NOT NULL DEFAULT 0,
  visits       INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_visit   TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE TABLE IF NOT EXISTS shifts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  status         TEXT NOT NULL CHECK (status IN ('open','closed')),
  opened_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at      TEXT,
  opened_by      TEXT,
  opening_float  INTEGER NOT NULL DEFAULT 0,
  expected_cash  INTEGER,
  counted_cash   INTEGER,
  note           TEXT,
  report         TEXT
);
-- At most one open shift at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open ON shifts(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS cash_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id    INTEGER NOT NULL REFERENCES shifts(id),
  kind        TEXT NOT NULL CHECK (kind IN ('in','out')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements(shift_id);

CREATE TABLE IF NOT EXISTS refunds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER NOT NULL REFERENCES sales(id),
  shift_id    INTEGER REFERENCES shifts(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  taxable     INTEGER NOT NULL,
  tax         INTEGER NOT NULL,
  method      TEXT NOT NULL,
  reason      TEXT NOT NULL,
  lines       TEXT NOT NULL,
  credit_note TEXT NOT NULL UNIQUE,
  ird_status  TEXT NOT NULL DEFAULT 'off',
  ird_response TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_refunds_sale ON refunds(sale_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  data        TEXT,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

// Additive column migrations for databases created by earlier versions.
const COLUMNS = {
  sales: { postponed: 'INTEGER NOT NULL DEFAULT 0', due_date: 'TEXT', member_discount: 'INTEGER NOT NULL DEFAULT 0', customer_id: 'INTEGER REFERENCES customers(id)', shift_id: 'INTEGER REFERENCES shifts(id)', refunded: 'INTEGER NOT NULL DEFAULT 0', points_earned: 'INTEGER NOT NULL DEFAULT 0', points_redeemed: 'INTEGER NOT NULL DEFAULT 0' },
  sale_items: { refunded_qty: 'REAL NOT NULL DEFAULT 0', membership_plan_id: 'INTEGER REFERENCES membership_plans(id)' },
  customers: { plan_id: 'INTEGER REFERENCES membership_plans(id)', member_since: 'TEXT', member_until: 'TEXT' },
  payments: { shift_id: 'INTEGER REFERENCES shifts(id)' },
};

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, def] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id); CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id); CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments(shift_id);');
  return db;
}

export const db = openDb(process.env.DB_FILE || path.join(config.dataDir, 'pos.db'));

/** Run fn inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();
