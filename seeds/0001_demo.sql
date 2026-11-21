-- 0001_demo.sql — data demo Seblak POS.
-- Jalankan SETELAH semua migrasi (0001-0008) pada database yang sama, mis.:
--   wrangler d1 execute seblak-pos-db --local --file=seeds/0001_demo.sql
-- Semua kata sandi akun demo: seblak123 (hash PBKDF2 sesuai worker/lib/password.ts,
-- dihasilkan dengan implementasi yang sama persis; JANGAN dipakai di produksi).

-- Outlet demo -----------------------------------------------------------------
INSERT INTO outlets (id, name, address, phone, tax_rate_bp, currency, is_active, created_at, updated_at, deleted_at, version)
VALUES ('a0000000-0000-4000-8000-000000000001', 'Seblak Demo Nusantara', 'Jl. Merdeka No. 1', '081200000001', 0, 'IDR', 1, 1763400000000, 1763400000000, NULL, 1);

-- Pengguna demo (owner, manager/admin, kasir, dapur) ---------------------------
INSERT INTO users (id, outlet_id, name, email, password_hash, role, pin_hash, is_active, created_at, updated_at, deleted_at, version) VALUES
('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Pemilik Demo', 'owner@demo.seblakpos.id', 'pbkdf2$100000$6Ue2zBBVbThgJqtGs/nqWQ==$o4v/aT9F9TakzpDfNc2k3dVv+3owSZl3+YT+9f+Gj84=', 'owner', NULL, 1, 1763400000000, 1763400000000, NULL, 1),
('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Admin Demo', 'admin@demo.seblakpos.id', 'pbkdf2$100000$pphQqPU0d680+2JAatYGXA==$cyJFj/UTq+aaTthurWM0wBw7kvYJ5fyZAG/dORJRRug=', 'manager', NULL, 1, 1763400000000, 1763400000000, NULL, 1),
('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Kasir Demo', 'kasir@demo.seblakpos.id', 'pbkdf2$100000$jP+HQUaEezQ4poun4T+ViQ==$i0HJ9Qu1nmsdqJcsGM+yVW8mo2Y/l3HVLiV7ADNUeZQ=', 'cashier', NULL, 1, 1763400000000, 1763400000000, NULL, 1),
('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'Dapur Demo', 'dapur@demo.seblakpos.id', 'pbkdf2$100000$O/XbntxOuwlrXoFgigPa7w==$KCRY4DUcuarrxrrBKYoaksuYvSNtVoFwu/vTaVGwzC4=', 'kitchen', NULL, 1, 1763400000000, 1763400000000, NULL, 1);

-- Kategori ---------------------------------------------------------------------
INSERT INTO categories (id, outlet_id, name, sort_order, color, created_at, updated_at, deleted_at, version) VALUES
('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Seblak', 1, '#D92323', 1763400000000, 1763400000000, NULL, 1),
('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Minuman', 2, '#E8871E', 1763400000000, 1763400000000, NULL, 1),
('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Topping', 3, '#7A4E1D', 1763400000000, 1763400000000, NULL, 1);

-- Produk jual + produk bahan baku (is_stock_tracked = 1) ------------------------
INSERT INTO products (id, outlet_id, category_id, name, sku, base_price, cost_price, is_stock_tracked, image_key, is_active, created_at, updated_at, deleted_at, version) VALUES
('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Seblak Original', 'SBL-ORI', 10000, 6000, 0, NULL, 1, 1763400000000, 1763400000000, NULL, 1),
('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'Es Teh Manis', 'MNM-ESTEH', 5000, 2000, 0, NULL, 1, 1763400000000, 1763400000000, NULL, 1),
('d0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'Stok Bakso Sapi', 'BHN-BAKSO', 0, 1500, 1, NULL, 1, 1763400000000, 1763400000000, NULL, 1),
('d0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'Stok Ceker Ayam', 'BHN-CEKER', 0, 2000, 1, NULL, 1, 1763400000000, 1763400000000, NULL, 1),
('d0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'Stok Telur Ayam', 'BHN-TELUR', 0, 2500, 1, NULL, 1, 1763400000000, 1763400000000, NULL, 1);

-- Grup opsi: Level Pedas (wajib, tunggal, gratis) + Topping (bebas, berbayar) ---
INSERT INTO modifiers (id, outlet_id, name, selection_type, is_required, min_select, max_select, created_at, updated_at, deleted_at, version) VALUES
('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Level Pedas', 'single', 1, 1, 1, 1763400000000, 1763400000000, NULL, 1),
('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Topping', 'multiple', 0, 0, NULL, 1763400000000, 1763400000000, NULL, 1);

INSERT INTO modifier_options (id, outlet_id, modifier_id, name, price_delta, stock_product_id, created_at, updated_at, deleted_at, version) VALUES
('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Level 0 - Tidak Pedas', 0, NULL, 1763400000000, 1763400000000, NULL, 1),
('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Level 1 - Sedang', 0, NULL, 1763400000000, 1763400000000, NULL, 1),
('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Level 2 - Pedas', 0, NULL, 1763400000000, 1763400000000, NULL, 1),
('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Level 3 - Ekstra Pedas', 0, NULL, 1763400000000, 1763400000000, NULL, 1),
('f0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'Bakso', 2000, 'd0000000-0000-4000-8000-000000000011', 1763400000000, 1763400000000, NULL, 1),
('f0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'Ceker', 3000, 'd0000000-0000-4000-8000-000000000012', 1763400000000, 1763400000000, NULL, 1),
('f0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'Telur', 4000, 'd0000000-0000-4000-8000-000000000013', 1763400000000, 1763400000000, NULL, 1);

-- Pasangkan kedua grup opsi ke Seblak Original ----------------------------------
INSERT INTO product_modifiers (id, outlet_id, product_id, modifier_id, sort_order, created_at, updated_at, deleted_at, version) VALUES
('f1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1, 1763400000000, 1763400000000, NULL, 1),
('f1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 2, 1763400000000, 1763400000000, NULL, 1);

-- Stok awal bahan baku: 100 pcs per bahan, lewat stock_movements ------------------
-- (type 'purchase' dengan note opening; skema G1a tidak punya type 'opening')
INSERT INTO stock_movements (id, outlet_id, product_id, batch_id, type, qty_delta, ref_type, ref_id, note, created_by, created_at) VALUES
('f2000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', NULL, 'purchase', 100, 'seed', '0001_demo', 'Stok awal (opening) seed demo', 'b0000000-0000-4000-8000-000000000001', 1763400000000),
('f2000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000012', NULL, 'purchase', 100, 'seed', '0001_demo', 'Stok awal (opening) seed demo', 'b0000000-0000-4000-8000-000000000001', 1763400000000),
('f2000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000013', NULL, 'purchase', 100, 'seed', '0001_demo', 'Stok awal (opening) seed demo', 'b0000000-0000-4000-8000-000000000001', 1763400000000);
