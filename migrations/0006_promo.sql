-- 0006_promo.sql — promotions, promotion_usages
-- Sesuai G1a bagian 4 urutan migrasi #6.

CREATE TABLE promotions (
  id           TEXT PRIMARY KEY,
  outlet_id    TEXT NOT NULL REFERENCES outlets(id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL
               CHECK (type IN ('percent','nominal','bogo','bundle','free_item')),
  config       TEXT,
  starts_at    INTEGER,
  ends_at      INTEGER,
  is_stackable INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  version      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_promotions_outlet ON promotions (outlet_id);

CREATE TABLE promotion_usages (
  id              TEXT PRIMARY KEY,
  outlet_id       TEXT NOT NULL REFERENCES outlets(id),
  promotion_id    TEXT NOT NULL REFERENCES promotions(id),
  order_id        TEXT NOT NULL REFERENCES orders(id),
  discount_amount INTEGER NOT NULL DEFAULT 0,
  applied_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  version         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_promotion_usages_order ON promotion_usages (order_id);
CREATE INDEX idx_promotion_usages_promotion ON promotion_usages (promotion_id);
