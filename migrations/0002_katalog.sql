-- 0002_katalog.sql — categories, products, product_variants,
-- modifiers, modifier_options, product_modifiers
-- Sesuai G1a bagian 4 urutan migrasi #2.

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  outlet_id  TEXT NOT NULL REFERENCES outlets(id),
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_categories_outlet ON categories (outlet_id);

CREATE TABLE products (
  id              TEXT PRIMARY KEY,
  outlet_id       TEXT NOT NULL REFERENCES outlets(id),
  category_id     TEXT REFERENCES categories(id),
  name            TEXT NOT NULL,
  sku             TEXT,
  base_price      INTEGER NOT NULL DEFAULT 0,
  cost_price      INTEGER NOT NULL DEFAULT 0,
  is_stock_tracked INTEGER NOT NULL DEFAULT 0,
  image_key       TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  version         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (outlet_id, sku)
);

CREATE INDEX idx_products_outlet ON products (outlet_id);
CREATE INDEX idx_products_category ON products (category_id);

CREATE TABLE product_variants (
  id          TEXT PRIMARY KEY,
  outlet_id   TEXT NOT NULL REFERENCES outlets(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  name        TEXT NOT NULL,
  price_delta INTEGER NOT NULL DEFAULT 0,
  sku_suffix  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_variants_product ON product_variants (product_id);

CREATE TABLE modifiers (
  id             TEXT PRIMARY KEY,
  outlet_id      TEXT NOT NULL REFERENCES outlets(id),
  name           TEXT NOT NULL,
  selection_type TEXT NOT NULL DEFAULT 'single'
                 CHECK (selection_type IN ('single','multiple')),
  is_required    INTEGER NOT NULL DEFAULT 0,
  min_select     INTEGER NOT NULL DEFAULT 0,
  max_select     INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  version        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_modifiers_outlet ON modifiers (outlet_id);

CREATE TABLE modifier_options (
  id              TEXT PRIMARY KEY,
  outlet_id       TEXT NOT NULL REFERENCES outlets(id),
  modifier_id     TEXT NOT NULL REFERENCES modifiers(id),
  name            TEXT NOT NULL,
  price_delta     INTEGER NOT NULL DEFAULT 0,
  stock_product_id TEXT REFERENCES products(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  version         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_modifier_options_modifier ON modifier_options (modifier_id);

CREATE TABLE product_modifiers (
  id          TEXT PRIMARY KEY,
  outlet_id   TEXT NOT NULL REFERENCES outlets(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  modifier_id TEXT NOT NULL REFERENCES modifiers(id),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  version     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (product_id, modifier_id)
);

CREATE INDEX idx_product_modifiers_product ON product_modifiers (product_id);
