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
- G1 (kontrak) berjalan: skema D1, kontrak API v1, design tokens, glossary, metric dictionary.
- Repo dibuat 21 November 2026 (private). Kode aplikasi mulai dibangun pada gate G2 (foundation) setelah kontrak G1 dikunci.

## Struktur folder (kontrak bersama)

- worker/ - Bima: entry Worker, router Hono, middleware.
- migrations/ - Bima: migrasi D1 berurutan, tidak pernah mengedit migrasi yang sudah rilis.
- src/features/ - modul fitur per domain (kasir, produk, stok, laporan, dan sebagainya).
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
