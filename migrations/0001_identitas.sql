-- 0001_identitas.sql — outlets, users
-- Sesuai G1a bagian 4 urutan migrasi #1. Waktu = INTEGER epoch milidetik (UTC).
-- Kolom standar: id, outlet_id, created_at, updated_at, deleted_at, version
-- (outlets tidak memiliki outlet_id karena ia adalah outlet itu sendiri).

CREATE TABLE outlets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  tax_rate_bp INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'IDR',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  outlet_id     TEXT NOT NULL REFERENCES outlets(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'cashier'
                CHECK (role IN ('owner','manager','cashier','kitchen')),
  pin_hash      TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (outlet_id, email)
);

CREATE INDEX idx_users_outlet ON users (outlet_id);
