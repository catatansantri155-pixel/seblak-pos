-- 0007_sistem.sql — audit_logs, idempotency_keys, sync_events
-- Sesuai G1a bagian 4 urutan migrasi #7.
-- Ketiganya tabel jurnal murni: tanpa updated_at/deleted_at/version.

CREATE TABLE audit_logs (
  id          TEXT PRIMARY KEY,
  outlet_id   TEXT NOT NULL REFERENCES outlets(id),
  user_id     TEXT REFERENCES users(id),
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_audit_logs_outlet_created ON audit_logs (outlet_id, created_at);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity, entity_id);

CREATE TABLE idempotency_keys (
  id            TEXT PRIMARY KEY,
  outlet_id     TEXT NOT NULL REFERENCES outlets(id),
  key           TEXT NOT NULL,
  request_hash  TEXT,
  response_json TEXT,
  status_code   INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (outlet_id, key)
);

CREATE TABLE sync_events (
  id           TEXT PRIMARY KEY,
  outlet_id    TEXT NOT NULL REFERENCES outlets(id),
  client_tx_id TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  payload_json TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','applied','conflict')),
  received_at  INTEGER NOT NULL,
  applied_at   INTEGER,
  created_at   INTEGER NOT NULL,
  UNIQUE (outlet_id, client_tx_id)
);

CREATE INDEX idx_sync_events_outlet_status ON sync_events (outlet_id, status);
