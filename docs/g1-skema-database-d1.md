> Status: DRAF disusun oleh Nailong pada 21 November 2026 berdasarkan Kontrak Bersama Seblak POS yang sudah dikunci tim, karena tugas resmi agent pemilik di AI Agent Living World berulang kali gagal dijalankan (timeout inferensi aplikasi). Dokumen ini menunggu pengerjaan ulang dan pengesahan agent pemilik (Bima) di dalam aplikasi sebelum dianggap final.

# G1a - Skema Database D1 & Rencana Migrasi

Pemilik area: Bima (Programmer). Penyusun draf: Nailong. Acuan: Kontrak Bersama Seblak POS, Charter Arka, Backlog Nadia (POS-001 s.d. POS-020), Metric Dictionary Lestari.

## 1. Prinsip skema

1. Semua uang adalah INTEGER minor unit (Rupiah), tidak pernah REAL/float.
2. Semua tabel bisnis memiliki outlet_id; tidak ada data lintas outlet dalam satu baris.
3. Soft delete dengan kolom deleted_at (NULL = aktif); data finansial tidak pernah dihapus fisik.
4. Optimistic concurrency: kolom version INTEGER mulai 1, naik setiap update; konflik menghasilkan error CONFLICT.
5. Rekaman yang dibuat offline membawa client_tx_id unik per outlet; server menolak duplikat (idempotensi tingkat data).
6. Waktu disimpan sebagai INTEGER epoch milidetik (UTC); zona waktu hanya urusan tampilan.
7. Stok TIDAK PERNAH diubah langsung; semua perubahan stok adalah baris baru di stock_movements.
8. Kolom standar tiap tabel: id (TEXT, UUID), outlet_id, created_at, updated_at, deleted_at, version - kecuali tabel jurnal murni (stock_movements, cash_movements, audit_logs, sync_events, idempotency_keys) yang tidak punya updated_at/deleted_at/version.

## 2. Daftar tabel (25)

### Identitas & outlet
- outlets: name, address, phone, tax_rate_bp (basis point), currency (default IDR), is_active.
- users: outlet_id, name, email (unik per outlet), password_hash, role (owner/manager/cashier/kitchen), pin_hash (opsional, untuk login cepat kasir), is_active.

### Katalog
- categories: outlet_id, name, sort_order, color.
- products: outlet_id, category_id, name, sku (unik per outlet), base_price, cost_price, is_stock_tracked, image_key, is_active.
- product_variants: product_id, name (mis. Level 3, Ekstra Telur), price_delta, sku_suffix.
- modifiers: outlet_id, name, selection_type (single/multiple), is_required, min_select, max_select.
- modifier_options: modifier_id, name, price_delta, stock_product_id (opsional, pengait bahan baku).
- product_modifiers: product_id, modifier_id, sort_order. (tabel penghubung)

### Meja & order
- tables: outlet_id, name (mis. M-01), area, capacity, is_active.
- orders: outlet_id, table_id (nullable), order_no (unik per outlet per hari), type (dine_in/takeaway/online), status (open/paid/completed/void), cashier_id, shift_id, subtotal, discount_total, tax_total, grand_total, client_tx_id, note.
- order_items: order_id, product_id, variant_id (nullable), qty, unit_price, line_discount, line_total, note.
- order_item_modifiers: order_item_id, modifier_option_id, name_snapshot, price_delta, qty.

### Pembayaran & shift kas
- payments: outlet_id, order_id, shift_id, method (cash/qris/edc/transfer), amount, status (settled/void/refunded), reference_no, client_tx_id.
- payment_allocations: payment_id, order_id, amount. (satu pembayaran bisa untuk banyak order dan sebaliknya; total alokasi harus sama dengan amount pembayaran - aturan rekonsiliasi Lestari)
- cash_shifts: outlet_id, cashier_id, opened_at, closed_at, opening_cash, expected_cash, counted_cash, difference, status (open/closed).
- cash_movements: shift_id, type (in/out/adjustment), amount, reason, created_by.

### Inventaris
- suppliers: outlet_id, name, phone, address, is_active.
- stock_batches: outlet_id, product_id, supplier_id, qty_in, qty_remaining, unit_cost, received_at, expires_at (nullable).
- stock_movements: outlet_id, product_id, batch_id (nullable), type (purchase/sale/adjustment/waste/return), qty_delta (bertanda), ref_type, ref_id, note, created_by.
- purchase_orders: outlet_id, supplier_id, po_no, status (draft/ordered/received/cancelled), total_cost, ordered_at, received_at.
- purchase_order_items: purchase_order_id, product_id, qty, unit_cost, qty_received.

### Promo
- promotions: outlet_id, name, type (percent/nominal/bogo/bundle/free_item), config (JSON), starts_at, ends_at, is_stackable, max_discount, is_active.
- promotion_usages: promotion_id, order_id, discount_amount, applied_at.

### Sistem
- audit_logs: outlet_id, user_id, action, entity, entity_id, before_json, after_json, created_at.
- idempotency_keys: outlet_id, key, request_hash, response_json, status_code, created_at. Unik (outlet_id, key).
- sync_events: outlet_id, client_tx_id, entity, entity_id, payload_json, status (pending/applied/conflict), received_at, applied_at.

## 3. Indeks penting

- orders (outlet_id, created_at), orders (outlet_id, order_no) unik, orders (shift_id).
- order_items (order_id); stock_movements (outlet_id, product_id, created_at).
- products (outlet_id, sku) unik; users (outlet_id, email) unik.
- idempotency_keys (outlet_id, key) unik; sync_events (outlet_id, client_tx_id) unik.

## 4. Urutan migrasi

1. 0001_identitas: outlets, users.
2. 0002_katalog: categories, products, product_variants, modifiers, modifier_options, product_modifiers.
3. 0003_order: tables, orders, order_items, order_item_modifiers.
4. 0004_pembayaran_shift: payments, payment_allocations, cash_shifts, cash_movements.
5. 0005_inventaris: suppliers, stock_batches, stock_movements, purchase_orders, purchase_order_items.
6. 0006_promo: promotions, promotion_usages.
7. 0007_sistem: audit_logs, idempotency_keys, sync_events.

Aturan: migrasi yang sudah rilis tidak pernah diedit; perubahan selalu migrasi baru. Setiap migrasi wajib bisa dijalankan ulang dengan aman di database kosong (uji Putri, G2).
