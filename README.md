# Seblak POS

Aplikasi kasir (Point of Sale) untuk usaha seblak dan kuliner UMKM Indonesia: cepat dipakai kasir, aman secara finansial, tetap berjalan saat internet mati (offline-first), dan datanya bisa dilacak penuh.

Repo ini dikembangkan oleh tim AI Agent Living World (Arka, Nadia, Bima, Sinta, Rara, Dimas, Lestari, Fajar, Putri, Rizky) untuk Catatan Santri. Operasi GitHub nyata dieksekusi oleh Nailong (asisten pemilik) berdasarkan spesifikasi tertulis tim.

## Stack

- Cloudflare Workers + Hono (API, prefix /api/v1)
- Cloudflare D1 (SQLite) + Drizzle ORM & migrations
- React + Vite + TypeScript + Tailwind CSS (frontend & PWA)
- Zod untuk validasi bersama, Vitest + Playwright untuk pengujian

## Status

- G0 (discovery) selesai: charter proyek, backlog POS-001 s.d. POS-020, audit akses, riset operasi.
- G1 (kontrak) SELESAI dan dikunci: skema D1, kontrak API v1, design tokens, glossary, metric dictionary, brand & aturan promo, dan test plan gerbang QA (dokumen tim di aplikasi; empat dokumen kontrak tersimpan di folder docs/ repo ini).
- G2 (fondasi) SELESAI: skeleton Worker + Hono dengan envelope & kode error sesuai kontrak API, migrasi D1 0001-0007 (26 tabel), skema Drizzle, workflow CI, dan test dasar - 18 berkas fondasi ter-commit di main.
- G3 (POS inti) SELESAI: backend auth nyata (sesi & peran), master data, shift kasir, order dengan harga server + promo + idempotency + stok lewat stock_movements, pembayaran tunai & non-tunai (konfirmasi owner/manager), dan antrean dapur (migrasi 0001-0008, 27 tabel, seed demo 4 peran); frontend AppShell per peran, login, kasir, dapur, daftar order, dan shift mengikuti design tokens G1. Terverifikasi: typecheck bersih, 37/37 test lulus, build frontend berhasil.
- G4 (operasi) SELESAI: backend laporan sesuai metric dictionary (ringkasan harian, per metode pembayaran, produk terlaris, rekonsiliasi shift), stok & gerakan stok, sinkronisasi offline (sync push/pull dengan dedupe client_tx_id), manajemen pengguna & outlet, dan CRUD promo dengan kode promo (migrasi 0009); frontend halaman Laporan, Stok, Pengguna, Pengaturan, dan Promo, plus outbox offline di kasir (checkout yang gagal jaringan tersimpan di perangkat lalu tersinkron otomatis). Terverifikasi: typecheck bersih, 65/65 test lulus, build produksi berhasil.
- Berikutnya: G5 (hardening) lalu G6 (rilis), sesuai backlog dan gerbang QA.

## Deploy

- Aplikasi di-deploy lewat Cloudflare Workers Builds yang terhubung ke repo ini; push ke main memicu build & deploy otomatis.
- Build command: `npm run build`. Deploy command: `npx wrangler d1 migrations apply seblak-pos-db --remote && npx wrangler deploy` (migrasi D1 diterapkan sebagai bagian dari deploy).
- Database: Cloudflare D1 bernama `seblak-pos-db`.
- URL live: https://seblak-pos.catatansantri155.workers.dev (status: sedang proses go-live). Cek kesehatan di `/api/v1/health`.

## Akun demo

Seed demo (`seeds/0001_demo.sql`) membuat outlet contoh beserta empat akun berikut; kata sandi semuanya `seblak123`:

- owner@demo.seblakpos.id
- admin@demo.seblakpos.id
- kasir@demo.seblakpos.id
- dapur@demo.seblakpos.id

Akun demo hanya untuk mencoba aplikasi dengan data contoh; jangan dipakai untuk jualan beneran.

## Struktur folder (kontrak bersama)

- worker/ - Bima: entry Worker, router Hono, middleware.
- migrations/ - Bima: migrasi D1 berurutan, tidak pernah mengedit migrasi yang sudah rilis.
- src/features/ - modul fitur per domain (kasir dengan outbox offline, dapur, order, shift, laporan, stok, promo, pengguna, pengaturan).
- src/components/ - Sinta: design system & komponen bersama.
- docs/ - dokumentasi: charter, backlog, kontrak API, glossary, metric dictionary.
- tests/ - Putri: unit, integrasi, dan E2E.
- .github/ - Rizky: template PR dan workflow CI.

## Aturan main

- Uang selalu integer minor unit (Rupiah), tidak pernah float.
- Semua mutasi order & pembayaran memakai Idempotency-Key; stok hanya berubah lewat stock_movements.
- Branch: feature/<agent>-<slug>; tidak ada push langsung ke main.
- Setiap PR wajib lolos gerbang QA (Putri) dan mengikuti template PR di .github/pull_request_template.md.
- Tidak ada secret/credential di repo; gunakan .env lokal dan secret manager Cloudflare.
