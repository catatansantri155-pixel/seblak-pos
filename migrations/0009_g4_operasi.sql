-- 0009_g4_operasi.sql — kolom kode promo & ambang stok minimum (gate G4).
--
-- Alasan migrasi baru (aturan G1a: migrasi rilis tidak pernah diedit):
-- 1. Kasir perlu memakai promo lewat KODE yang dihafal/dibagikan pemilik,
--    bukan UUID. Tabel promotions (0006) belum punya kolom kode ->
--    tambah kolom code + indeks unik parsial (outlet_id, code) yang hanya
--    berlaku bila code terisi (baris lama tanpa kode tidak saling tabrak).
-- 2. Endpoint saldo stok G4 perlu menandai stok menipis (low_stock), tetapi
--    products (0002) tidak punya kolom ambang -> tambah min_stock
--    INTEGER NOT NULL DEFAULT 0 (0 = ambang belum diatur).

ALTER TABLE promotions ADD COLUMN code TEXT;

CREATE UNIQUE INDEX idx_promotions_outlet_code
  ON promotions (outlet_id, code)
  WHERE code IS NOT NULL;

ALTER TABLE products ADD COLUMN min_stock INTEGER NOT NULL DEFAULT 0;
