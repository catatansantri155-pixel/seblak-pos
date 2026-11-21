> Status: DRAF disusun oleh Nailong pada 21 November 2026 berdasarkan Kontrak Bersama Seblak POS yang sudah dikunci tim, karena tugas resmi agent pemilik di AI Agent Living World berulang kali gagal dijalankan (timeout inferensi aplikasi). Dokumen ini menunggu pengerjaan ulang dan pengesahan agent pemilik di dalam aplikasi sebelum dianggap final.

# G1 - Rancangan Brand & Aturan Promo

Pemilik area: Fajar (Marketing). Penyusun draf: Nailong. Selaras dengan Design Tokens Sinta dan Glossary & Microcopy Rara.

## 1. Identitas brand produk

- Nama produk: Seblak POS.
- Janji brand (tagline kerja): "Kasir secepat sambal dibikin." - cepat, pedas, tidak ribet.
- Kepribadian: hangat dan berani (seperti warung seblak favorit), tapi rapi dan bisa dipercaya untuk urusan uang.
- Pengguna yang dibayangkan: pemilik & kasir warung seblak dan kuliner UMKM Indonesia; layar sentuh Android kelas menengah; pencahayaan terang; tangan sibuk - jadi tombol besar, kontras tinggi, sedikit ketikan.

## 2. Arah visual (mengacu Design Tokens Sinta)

- Warna utama: merah cabai (primary) untuk aksi utama & penanda pedas; oranye kunyit (secondary) untuk aksen & promo; krem/putih hangat untuk latar; arang untuk teks.
- Status warna wajib konsisten: hijau = lunas/berhasil, kuning = menunggu/ditahan, merah = void/gagal/stok kritis, abu = nonaktif.
- Logo arah: mangkuk seblak sederhana dengan lidah api kecil; satu warna bisa dipakai di struk termal (monokrom tetap terbaca).
- Tipografi: satu keluarga font sans yang terbaca di ukuran kecil untuk angka struk; angka uang selalu tabular (rata kanan, lebar digit sama).

## 3. Jenis promo yang didukung (sesuai tabel promotions)

1. percent - diskon persen dari subtotal atau item tertentu.
2. nominal - potongan nominal tetap.
3. bogo - beli X gratis Y (item sama atau item yang ditentukan).
4. bundle - paket beberapa item dengan harga khusus.
5. free_item - item gratis bila syarat keranjang terpenuhi.

## 4. Aturan main promo (mengikat, dihitung server)

1. Semua perhitungan promo dilakukan server di POST /orders; klien tidak menentukan angka diskon final.
2. Batas keras: total diskon tidak boleh membuat grand_total negatif; max_discount pada promo adalah plafon mutlak per order.
3. Penumpukan: default promo TIDAK bisa ditumpuk. Hanya promo dengan is_stackable = true yang boleh bergabung, dan maksimal 2 promo per order.
4. Urutan hitung: promo item (bogo/bundle/free_item) dulu, lalu promo subtotal (percent/nominal), lalu pajak dihitung dari nilai setelah diskon.
5. Setiap penerapan tercatat di promotion_usages (promotion_id, order_id, discount_amount) - dasar laporan Lestari.
6. Order yang di-void membatalkan usage-nya secara logis (usage tetap tercatat, order berstatus void; laporan mengecualikan order void).
7. Refund pembayaran tidak mengubah catatan usage; laporan promo selalu berbasis order, bukan pembayaran.
8. Masa berlaku: starts_at s.d. ends_at (epoch ms, UTC); di luar rentang itu promo tidak muncul di daftar aktif dan ditolak server bila dipaksakan.
9. Hak membuat/mengubah promo: owner & manager. Kasir hanya memakai promo yang aktif.
10. Promo tidak berlaku surut: order yang sudah paid tidak bisa diberi promo sesudahnya.

## 5. Contoh hitung (minor unit, Rp)

Keranjang: 2x Seblak Komplit @15.000 = 30.000; promo percent 10% (max_discount 5.000), pajak 0 untuk contoh ini.
- Subtotal 30.000; diskon 10% = 3.000 (di bawah plafon 5.000, lolos); grand_total 27.000.
- Bila promo percent 50% dengan max_discount 5.000: diskon seharusnya 15.000, dipotong plafon menjadi 5.000; grand_total 25.000.

## 6. Kebutuhan konten & aset (untuk Rara dan Sinta)

- Teks promo di kasir maksimal 2 baris, bahasa sesuai Glossary Rara (istilah baku: Lunas, Ditahan, Batal, Shift, Rekonsiliasi).
- Struk: nama promo yang terpakai dicetak di bawah subtotal beserta nilai potongannya.
- Materi promosi ke pelanggan (poster/banner di aplikasi) di luar cakupan G1; dokumen ini hanya mengatur promo di dalam sistem.
