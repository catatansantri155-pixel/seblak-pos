-- 0005_inventaris.sql — suppliers, stock_batches, stock_movements,
-- purchase_orders, purchase_order_items
-- Sesuai G1a bagian 4 urutan migrasi #5.
-- stock_movements adalah tabel jurnal murni: tanpa updated_at/deleted_at/version.
-- Stok TIDAK PERNAH diubah langsung; semua perubahan adalah baris stock_movements.

CREATE TABLE suppliers (
  id         TEXT PRIMARY KEY,
  outlet_id  TEXT NOT NULL REFERENCES outlets(id),
  name       TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_suppliers_outlet ON suppliers (outlet_id);

CREATE TABLE stock_batches (
  id            TEXT PRIMARY KEY,
  outlet_id     TEXT NOT NULL REFERENCES outlets(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  supplier_id   TEXT REFERENCES suppliers(id),
  qty_in        INTEGER NOT NULL DEFAULT 0,
  qty_remaining INTEGER NOT NULL DEFAULT 0,
  unit_cost     INTEGER NOT NULL DEFAULT 0,
  received_at   INTEGER NOT NULL,
  expires_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_stock_batches_product ON stock_batches (outlet_id, product_id);

CREATE TABLE stock_movements (
  id         TEXT PRIMARY KEY,
  outlet_id  TEXT NOT NULL REFERENCES outlets(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  batch_id   TEXT REFERENCES stock_batches(id),
  type       TEXT NOT NULL
             CHECK (type IN ('purchase','sale','adjustment','waste','return')),
  qty_delta  INTEGER NOT NULL DEFAULT 0,
  ref_type   TEXT,
  ref_id     TEXT,
  note       TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_stock_movements_lookup ON stock_movements (outlet_id, product_id, created_at);

CREATE TABLE purchase_orders (
  id          TEXT PRIMARY KEY,
  outlet_id   TEXT NOT NULL REFERENCES outlets(id),
  supplier_id TEXT REFERENCES suppliers(id),
  po_no       TEXT,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','ordered','received','cancelled')),
  total_cost  INTEGER NOT NULL DEFAULT 0,
  ordered_at  INTEGER,
  received_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_purchase_orders_outlet ON purchase_orders (outlet_id);

CREATE TABLE purchase_order_items (
  id                TEXT PRIMARY KEY,
  outlet_id         TEXT NOT NULL REFERENCES outlets(id),
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id        TEXT REFERENCES products(id),
  qty               INTEGER NOT NULL DEFAULT 0,
  unit_cost         INTEGER NOT NULL DEFAULT 0,
  qty_received      INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_po_items_po ON purchase_order_items (purchase_order_id);
