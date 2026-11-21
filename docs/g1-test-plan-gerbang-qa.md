> Status: DRAF disusun oleh Nailong pada 21 November 2026 berdasarkan Kontrak Bersama Seblak POS yang sudah dikunci tim, karena tugas resmi agent pemilik di AI Agent Living World berulang kali gagal dijalankan (timeout inferensi aplikasi). Dokumen ini menunggu pengerjaan ulang dan pengesahan agent pemilik di dalam aplikasi sebelum dianggap final.

# G1 - Test Plan & Matriks Gerbang QA

Pemilik area: Putri (QA Engineer). Penyusun draf: Nailong. Acuan: Kontrak Bersama, G1a (skema), G1b (API), Metric Dictionary Lestari, template PR repo.

## 1. Strategi pengujian

- Tingkat: unit (Vitest) untuk logika uang, promo, dan stok; integrasi untuk endpoint API + D1 (uji migrasi dari database kosong); E2E (Playwright) untuk alur kasir utama.
- Prinsip: uang dan stok diuji paling keras. Setiap aturan bernomor di G1a/G1b dan dokumen Brand & Promo harus punya minimal satu test yang menyebut nomor aturannya.
- Lingkungan: lokal + preview Cloudflare; data uji tanpa data pribadi nyata; tanpa secret di repo.

## 2. Skenario kritis (wajib lulus semua)

Order & kasir:
1. Buat order dine-in dan takeaway; total dihitung ulang server (klien mengirim angka salah -> server tetap benar).
2. Replay POST /orders dengan Idempotency-Key yang sama menghasilkan order yang sama persis (tidak ganda).
3. Kunci idempotensi sama dengan isi berbeda -> CONFLICT.
4. Ubah order dengan version lama -> CONFLICT.
5. Void order wajib alasan dan tercatat di audit_logs.

Pembayaran & shift:
6. Alokasi pembayaran kurang/lebih dari amount -> PAYMENT_MISMATCH.
7. Pembayaran lunas menandai order paid; pembayaran sebagian tidak.
8. Transaksi tanpa shift open -> SHIFT_NOT_OPEN.
9. Tutup shift: expected_cash cocok dengan hitungan (opening + cash in - cash out + penjualan tunai); difference tampil benar untuk kasus selisih.
10. Refund hanya oleh manager/owner; kasir -> FORBIDDEN.

Stok:
11. Penjualan mengurangi stok hanya lewat stock_movements type sale; saldo tidak pernah negatif tanpa adjustment beralasan.
12. Penjualan melebihi stok -> INSUFFICIENT_STOCK (untuk produk is_stock_tracked).
13. Penerimaan purchase order membuat batch + movement type purchase; FIFO tidak merusak saldo batch.

Promo:
14. Plafon max_discount memotong diskon persen yang lebih besar (contoh hitung di dokumen Brand & Promo harus lolos persis).
15. Promo non-stackable kedua ditolak; dua promo stackable boleh; promo ketiga ditolak.
16. Promo kedaluwarsa tidak bisa diterapkan.

Offline & sinkronisasi:
17. Order dibuat offline (client_tx_id) lalu sync/push: diterapkan sekali; push ulang batch yang sama tidak menggandakan.
18. Konflik versi saat push dijawab per item sebagai conflict, bukan menggagalkan seluruh batch.

Laporan:
19. Laporan harian cocok dengan definisi Metric Dictionary (gross, net, refund, diskon, pajak, per metode).
20. Rekonsiliasi shift cocok dengan payments + cash_movements pada rentang shift itu.

## 3. Matriks gerbang

| Gate | Syarat masuk | Syarat lulus (exit) |
|---|---|---|
| G2 Foundation | G1 dikunci Arka/Nadia | Migrasi 0001-0007 jalan dari kosong; auth & envelope API sesuai G1b; CI hijau (lint, typecheck, test, build) |
| G3 Core POS | G2 lulus | Skenario kritis 1-10 lulus; alur kasir E2E hijau |
| G4 Operasional | G3 lulus | Skenario 11-20 lulus; laporan cocok dengan Metric Dictionary |
| G5 Hardening | G4 lulus | Uji beban wajar 1 outlet; uji offline penuh 1 hari simulasi; audit keamanan dasar (peran, soft delete, tanpa secret) |
| G6 Rilis | G5 lulus | Semua skenario kritis hijau di build rilis; checklist PR lengkap; persetujuan pemilik |

## 4. Aturan cacat (defect)

- Blocker: uang/stok salah, data hilang, tidak bisa jualan. Critical: alur utama putus tanpa jalan memutar. Major: fungsi penting terganggu, ada jalan memutar. Minor: tampilan/kosmetik.
- Merge dilarang bila ada Blocker/Critical terbuka. Major boleh merge hanya dengan catatan tertulis Nadia dan jadwal perbaikan.
- Setiap cacat yang ditemukan di produksi menjadi test regresi baru sebelum perbaikan dinyatakan selesai.

## 5. Checklist sign-off per PR (selaras template PR repo)

- [ ] Cakupan sesuai ownership; migrasi aman; tanpa secret
- [ ] Test relevan ditambah/diperbarui dan hasilnya dicantumkan
- [ ] Screenshot UI untuk perubahan tampilan
- [ ] Risiko & rollback ditulis
- [ ] Status: Siap diperiksa Putri -> Lulus / Lulus bersyarat / Ditolak
