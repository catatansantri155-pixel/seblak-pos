-- 0003_order.sql — tables, orders, order_items, order_item_modifiers
-- Sesuai G1a bagian 4 urutan migrasi #3.
-- Catatan: orders.shift_id merujuk cash_shifts yang baru dibuat di 0004;
-- SQLite/D1 menerima referensi maju pada DDL (pengecekan FK terjadi saat DML).

CREATE TABLE tables (
  id         TEXT PRIMARY KEY,
  outlet_id  TEXT NOT NULL REFERENCES outlets(id),
  name       TEXT NOT NULL,
  area       TEXT,
  capacity   INTEGER NOT NULL DEFAULT 1,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tables_outlet ON tables (outlet_id);

CREATE TABLE orders (
  id             TEXT PRIMARY KEY,
  outlet_id      TEXT NOT NULL REFERENCES outlets(id),
  table_id       TEXT REFERENCES tables(id),
  order_no       TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'dine_in'
                 CHECK (type IN ('dine_in','takeaway','online')),
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','paid','completed','void')),
  cashier_id     TEXT REFERENCES users(id),
  shift_id       TEXT REFERENCES cash_shifts(id),
  subtotal       INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total      INTEGER NOT NULL DEFAULT 0,
  grand_total    INTEGER NOT NULL DEFAULT 0,
  client_tx_id   TEXT,
  note           TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  version        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (outlet_id, order_no)
);

CREATE INDEX idx_orders_outlet_created ON orders (outlet_id, created_at);
CREATE INDEX idx_orders_shift ON orders (shift_id);
-- Idempotensi tingkat data (G1a prinsip 5): client_tx_id unik per outlet;
-- baris tanpa client_tx_id (NULL) tidak saling bertabrakan di SQLite.
CREATE UNIQUE INDEX idx_orders_client_tx ON orders (outlet_id, client_tx_id);

CREATE TABLE order_items (
  id            TEXT PRIMARY KEY,
  outlet_id     TEXT NOT NULL REFERENCES outlets(id),
  order_id      TEXT NOT NULL REFERENCES orders(id),
  product_id    TEXT REFERENCES products(id),
  variant_id    TEXT REFERENCES product_variants(id),
  qty           INTEGER NOT NULL DEFAULT 1,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  line_discount INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE order_item_modifiers (
  id                TEXT PRIMARY KEY,
  outlet_id         TEXT NOT NULL REFERENCES outlets(id),
  order_item_id     TEXT NOT NULL REFERENCES order_items(id),
  modifier_option_id TEXT REFERENCES modifier_options(id),
  name_snapshot     TEXT,
  price_delta       INTEGER NOT NULL DEFAULT 0,
  qty               INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_order_item_modifiers_item ON order_item_modifiers (order_item_id);
