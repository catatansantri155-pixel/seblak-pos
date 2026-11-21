# Seed Demo Seblak POS

`0001_demo.sql` mengisi data contoh ke database yang sudah menjalankan semua
migrasi (`migrations/0001` s.d. `0008`). Jalankan sekali saja per database:

```bash
wrangler d1 execute seblak-pos-db --local --file=seeds/0001_demo.sql
# atau untuk database remote:
wrangler d1 execute seblak-pos-db --remote --file=seeds/0001_demo.sql
```

## Akun demo (kata sandi semua akun: `seblak123`)

| Peran   | Email                     |
| ------- | ------------------------- |
| Owner   | owner@demo.seblakpos.id   |
| Manager | admin@demo.seblakpos.id   |
| Kasir   | kasir@demo.seblakpos.id   |
| Dapur   | dapur@demo.seblakpos.id   |

Kata sandi tersimpan sebagai hash PBKDF2 (`pbkdf2$100000$...`) yang dihasilkan
dengan implementasi yang sama persis dengan `worker/lib/password.ts`.
**Akun demo hanya untuk pengembangan — jangan pernah dipakai di produksi.**

## Isi seed

- 1 outlet: "Seblak Demo Nusantara" (pajak 0%).
- Kategori: Seblak, Minuman, Topping.
- Produk jual: Seblak Original Rp10.000, Es Teh Manis Rp5.000.
- Bahan baku (produk `is_stock_tracked`): Stok Bakso Sapi, Stok Ceker Ayam,
  Stok Telur Ayam — masing-masing stok awal 100 pcs lewat `stock_movements`
  type `purchase` dengan note "Stok awal (opening) seed demo" (skema G1a tidak
  mempunyai type `opening`).
- Grup opsi untuk Seblak Original:
  - **Level Pedas** (wajib, pilihan tunggal, gratis): Level 0 s.d. Level 3.
  - **Topping** (bebas, boleh banyak): Bakso +Rp2.000, Ceker +Rp3.000,
    Telur +Rp4.000 — masing-masing terhubung ke bahan baku di atas, jadi
    penjualan topping mengurangi stok bahan secara otomatis.

Contoh alur uji manual: login sebagai kasir -> buka shift -> buat order
2x Seblak Original dengan Bakso x2 + Ceker + Telur (total Rp42.000) ->
bayar tunai Rp50.000 (kembalian Rp8.000) -> dapur memproses antrean.
