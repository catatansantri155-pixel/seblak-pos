-- 0008_sesi_dan_status.sql — sessions, orders.payment_status/kitchen_status,
-- payments.status 'pending' + payments.change_amount.
--
-- Alasan migrasi baru ini (aturan G1a: migrasi rilis tidak pernah diedit,
-- perubahan selalu migrasi baru):
-- 1. Fondasi G2 (0001-0007) belum punya tabel sesi, padahal login G1b
--    menerbitkan token sesi yang harus bisa dicabut (logout) -> tabel sessions
--    menyimpan HASH token (bukan token mentah).
-- 2. G3 mensyaratkan status order, status pembayaran, dan status dapur sebagai
--    kolom terpisah; 0003 hanya punya orders.status -> tambah payment_status
--    dan kitchen_status.
-- 3. Pembayaran non-tunai manual perlu status 'pending' (menunggu konfirmasi)
--    yang belum ada di CHECK payments.status pada 0004, dan kembalian tunai
--    perlu tercatat -> bangun ulang tabel payments (pola standar SQLite:
--    buat baru, salin, tukar) dengan CHECK yang diperluas + kolom change_amount.

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  outlet_id    TEXT NOT NULL REFERENCES outlets(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  last_seen_at INTEGER
);

CREATE INDEX idx_sessions_token ON sessions (token_hash);
CREATE INDEX idx_sessions_user ON sessions (user_id);

ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid','partial','paid'));
ALTER TABLE orders ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'queued'
  CHECK (kitchen_status IN ('queued','cooking','done'));

CREATE TABLE payments_new (
  id           TEXT PRIMARY KEY,
  outlet_id    TEXT NOT NULL REFERENCES outlets(id),
  order_id     TEXT REFERENCES orders(id),
  shift_id     TEXT REFERENCES cash_shifts(id),
  method       TEXT NOT NULL
               CHECK (method IN ('cash','qris','edc','transfer')),
  amount       INTEGER NOT NULL DEFAULT 0,
  change_amount INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'settled'
               CHECK (status IN ('pending','settled','void','refunded')),
  reference_no TEXT,
  client_tx_id TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  version      INTEGER NOT NULL DEFAULT 1
);

INSERT INTO payments_new (id, outlet_id, order_id, shift_id, method, amount,
  status, reference_no, client_tx_id, created_at, updated_at, deleted_at,
  version)
SELECT id, outlet_id, order_id, shift_id, method, amount,
  status, reference_no, client_tx_id, created_at, updated_at, deleted_at,
  version FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

CREATE INDEX idx_payments_outlet ON payments (outlet_id);
CREATE INDEX idx_payments_order ON payments (order_id);
CREATE INDEX idx_payments_shift ON payments (shift_id);
CREATE UNIQUE INDEX idx_payments_client_tx ON payments (outlet_id, client_tx_id);
