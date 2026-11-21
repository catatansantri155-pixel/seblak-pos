> Status: DRAF disusun oleh Nailong pada 21 November 2026 berdasarkan Kontrak Bersama Seblak POS yang sudah dikunci tim, karena tugas resmi agent pemilik di AI Agent Living World berulang kali gagal dijalankan (timeout inferensi aplikasi). Dokumen ini menunggu pengerjaan ulang dan pengesahan agent pemilik (Bima) di dalam aplikasi sebelum dianggap final.

# G1b - Kontrak API v1

Pemilik area: Bima (Programmer). Penyusun draf: Nailong. Mengacu pada skema di G1a dan Metric Dictionary Lestari.

## 1. Dasar

- Base URL: /api/v1 (Cloudflare Workers + Hono). Semua response JSON.
- Autentikasi: header Authorization: Bearer <token sesi>. Token diterbitkan POST /api/v1/auth/login.
- Semua mutasi order dan pembayaran WAJIB membawa header Idempotency-Key (UUID dari klien).
- Uang selalu integer minor unit. Waktu di response meta sebagai ISO 8601 UTC.

## 2. Envelope response

Sukses:
    { "data": ..., "meta": { "request_id": "...", "server_time": "..." } }
Daftar (list) menambah meta.pagination: { "page": 1, "per_page": 20, "total": 137 }.
Error:
    { "error": { "code": "...", "message": "...", "details": ... }, "meta": { "request_id": "..." } }

## 3. Kode error standar

| Code | HTTP | Arti |
|---|---|---|
| VALIDATION_ERROR | 422 | Input tidak valid (details berisi per-field) |
| UNAUTHORIZED | 401 | Belum login / token tidak sah |
| FORBIDDEN | 403 | Peran tidak berhak |
| NOT_FOUND | 404 | Data tidak ada / sudah di-soft-delete |
| CONFLICT | 409 | Konflik version atau client_tx_id duplikat |
| INSUFFICIENT_STOCK | 422 | Stok tidak cukup untuk penjualan |
| SHIFT_NOT_OPEN | 422 | Kasir belum membuka shift |
| PAYMENT_MISMATCH | 422 | Total alokasi pembayaran tidak sama dengan amount |
| RATE_LIMITED | 429 | Terlalu banyak permintaan |
| INTERNAL_ERROR | 500 | Kesalahan server (tanpa rincian internal) |

## 4. Aturan idempotensi

- Kunci disimpan per (outlet_id, Idempotency-Key) beserta hash isi request.
- Replay dengan kunci dan isi yang sama mengembalikan response asli (status & body) tanpa efek samping ganda.
- Kunci sama dengan isi berbeda menghasilkan CONFLICT.
- Rekaman kunci disimpan minimal 24 jam.

## 5. Pagination & filter

- Query: page (mulai 1), per_page (default 20, maks 100), sort (mis. -created_at), filter per modul (mis. status, shift_id, date_from, date_to).
- Response list selalu menyertakan meta.pagination.

## 6. Endpoint per modul

Auth:
- POST /api/v1/auth/login - login email + kata sandi (atau PIN kasir), menerbitkan token.
- POST /api/v1/auth/logout - mencabut token.
- GET /api/v1/auth/me - profil & peran pengguna aktif.

Produk & katalog:
- GET /api/v1/categories, POST /api/v1/categories, PATCH /api/v1/categories/:id, DELETE /api/v1/categories/:id (soft delete)
- GET /api/v1/products (filter category_id, q, is_active), POST /api/v1/products, GET /api/v1/products/:id, PATCH /api/v1/products/:id, DELETE /api/v1/products/:id (soft delete)
- POST /api/v1/products/:id/variants, PATCH /api/v1/variants/:id, DELETE /api/v1/variants/:id
- GET /api/v1/modifiers, POST /api/v1/modifiers, PATCH /api/v1/modifiers/:id (termasuk options di dalamnya)

Order:
- GET /api/v1/orders (filter status, shift_id, table_id, tanggal), POST /api/v1/orders (Idempotency-Key wajib; menghitung ulang harga di server)
- GET /api/v1/orders/:id, PATCH /api/v1/orders/:id (ubah item/status; wajib version cocok)
- POST /api/v1/orders/:id/void (wajib alasan; tercatat di audit_logs)

Pembayaran:
- POST /api/v1/payments (Idempotency-Key wajib; body berisi allocations; server memvalidasi PAYMENT_MISMATCH dan menandai order paid bila lunas)
- POST /api/v1/payments/:id/refund (peran manager/owner)

Shift kas:
- POST /api/v1/shifts/open (satu shift open per kasir per outlet; selain itu SHIFT_NOT_OPEN/CONFLICT)
- POST /api/v1/shifts/:id/close (counted_cash wajib; server menghitung expected & difference)
- GET /api/v1/shifts (filter tanggal, cashier_id), POST /api/v1/shifts/:id/cash-movements

Inventaris:
- GET /api/v1/stock (saldo per produk dari stock_movements), GET /api/v1/stock/movements
- POST /api/v1/stock/adjustments (type adjustment/waste; wajib note)
- GET /api/v1/purchase-orders, POST /api/v1/purchase-orders, POST /api/v1/purchase-orders/:id/receive (membuat stock_batches + stock_movements type purchase)

Promo:
- GET /api/v1/promotions (yang aktif & berlaku), POST /api/v1/promotions, PATCH /api/v1/promotions/:id
- Penerapan promo terjadi di dalam POST /api/v1/orders (server yang menghitung; klien tidak mengirim angka diskon final)

Laporan:
- GET /api/v1/reports/daily (ringkasan harian per definisi Metric Dictionary: gross sales, net sales, refund, diskon, pajak, per metode bayar)
- GET /api/v1/reports/shift/:id (rekonsiliasi shift: expected vs counted vs difference)
- GET /api/v1/reports/top-products (produk terlaris per rentang tanggal)

Sinkronisasi offline:
- POST /api/v1/sync/push (batch sync_events dari klien; per item dijawab applied/conflict beserta alasannya)
- GET /api/v1/sync/pull?since=<epoch_ms> (perubahan server sejak titik waktu itu)

## 7. Aturan versi

- Perubahan yang merusak kontrak menaikkan versi mayor (/api/v2). Penambahan field yang kompatibel tidak menaikkan versi.
- Kontrak ini dikunci di G1; perubahan sesudahnya lewat usulan tertulis ke Nadia dan pengesahan Arka.
