-- 0004_pembayaran_shift.sql — cash_shifts, cash_movements, payments,
-- payment_allocations
-- Sesuai G1a bagian 4 urutan migrasi #4. cash_shifts dibuat lebih dulu di
-- berkas ini karena dirujuk oleh orders (0003) dan payments.
-- cash_movements adalah tabel jurnal murni: tanpa updated_at/deleted_at/version.

CREATE TABLE cash_shifts (
  id            TEXT PRIMARY KEY,
  outlet_id     TEXT NOT NULL REFERENCES outlets(id),
  cashier_id    TEXT REFERENCES users(id),
  opened_at     INTEGER NOT NULL,
  closed_at     INTEGER,
  opening_cash  INTEGER NOT NULL DEFAULT 0,
  expected_cash INTEGER,
  counted_cash  INTEGER,
  difference    INTEGER,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','closed')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_cash_shifts_outlet ON cash_shifts (outlet_id);
CREATE INDEX idx_cash_shifts_cashier ON cash_shifts (cashier_id);

CREATE TABLE cash_movements (
  id         TEXT PRIMARY KEY,
  outlet_id  TEXT NOT NULL REFERENCES outlets(id),
  shift_id   TEXT NOT NULL REFERENCES cash_shifts(id),
  type       TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
  amount     INTEGER NOT NULL DEFAULT 0,
  reason     TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_cash_movements_shift ON cash_movements (shift_id);

CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  outlet_id    TEXT NOT NULL REFERENCES outlets(id),
  order_id     TEXT REFERENCES orders(id),
  shift_id     TEXT REFERENCES cash_shifts(id),
  method       TEXT NOT NULL
               CHECK (method IN ('cash','qris','edc','transfer')),
  amount       INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'settled'
               CHECK (status IN ('settled','void','refunded')),
  reference_no TEXT,
  client_tx_id TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  version      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_payments_outlet ON payments (outlet_id);
CREATE INDEX idx_payments_order ON payments (order_id);
CREATE INDEX idx_payments_shift ON payments (shift_id);
CREATE UNIQUE INDEX idx_payments_client_tx ON payments (outlet_id, client_tx_id);

CREATE TABLE payment_allocations (
  id         TEXT PRIMARY KEY,
  outlet_id  TEXT NOT NULL REFERENCES outlets(id),
  payment_id TEXT NOT NULL REFERENCES payments(id),
  order_id   TEXT NOT NULL REFERENCES orders(id),
  amount     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_allocations_payment ON payment_allocations (payment_id);
CREATE INDEX idx_allocations_order ON payment_allocations (order_id);
