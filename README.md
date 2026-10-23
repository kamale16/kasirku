# KasirKu

Aplikasi kasir (point of sale) berbasis web untuk warung atau toko kecil: kasir memilih produk, menghitung total dan kembalian, lalu mencetak struk. Admin mengelola produk, stok, pengguna, dan melihat laporan penjualan.

**Demo:** _tempel link Vercel di sini setelah deploy_

![Layar kasir](docs/2-kasir.png)

## Fitur
- **Kasir:** pencarian produk (Enter menambah), keranjang, tombol uang pas dan nominal cepat, kembalian otomatis, struk yang bisa dicetak
- **Admin:** CRUD produk dan stok, kelola akun kasir, laporan omzet harian, 7 hari terakhir, produk terlaris, dan peringatan stok menipis
- **Peran:** `kasir` dan `admin` dengan pembatasan akses di server (kasir hanya melihat struk miliknya)
- **Responsif:** nyaman dipakai di tablet dan HP

## Keputusan teknis
- **Stok tidak bisa terjual dua kali.** Checkout berjalan dalam satu transaksi database dengan pengurangan stok bersyarat (`UPDATE ... WHERE stock >= qty`). Kalau satu barang gagal, stok barang lain ikut dikembalikan.
- **Harga selalu dari database.** Klien hanya mengirim ID produk dan jumlah, jadi harga tidak bisa dimanipulasi dari browser.
- **Satu SQL untuk dua database.** PostgreSQL di produksi (Neon), PGlite (PostgreSQL di dalam proses) untuk lokal dan tes, tanpa instalasi apa pun.
- **Keamanan:** password di-hash (bcrypt), sesi JWT di cookie `httpOnly` + `SameSite=Lax`, semua perubahan data wajib `application/json` (mencegah CSRF form lintas situs), query terparameter, header keamanan lewat Helmet, dan UI dibangun tanpa `innerHTML` (aman dari XSS).
- 12 tes otomatis (`node:test`), dijalankan di PGlite dan di PostgreSQL sungguhan.

## Tech stack
Node.js 20+, Express 5, PostgreSQL (`pg`) / PGlite, JWT, bcryptjs, JavaScript tanpa framework di sisi klien.

## Menjalankan di komputer
```bash
git clone <url-repo-kamu>
cd kasirku
npm install
npm start
```
Buka http://localhost:3000. Database lokal dibuat otomatis di folder `.data/` beserta data demo.

| Peran | Username | Password |
|---|---|---|
| Admin | admin | `ADMIN_PASSWORD` (bawaan lokal: admin123) |
| Kasir | kasir1 | kasir123 |

## Tes
```bash
npm test                                                          # PGlite (tanpa instalasi)
TEST_DATABASE_URL=postgresql://user:pass@host/db npm test         # PostgreSQL sungguhan
```

## Deploy ke Vercel + Neon
1. Push repo ke GitHub, lalu di vercel.com pilih **Add New > Project** dan impor repo ini (Vercel mendeteksi Express otomatis dari `index.js`).
2. Buat database PostgreSQL gratis di Neon (lewat **Storage / Marketplace** di Vercel, atau neon.com) dan salin connection string yang memakai `-pooler`.
3. Isi Environment Variables:

| Nama | Isi |
|---|---|
| `JWT_SECRET` | string acak panjang (wajib; aplikasi menolak jalan tanpa ini di produksi) |
| `ADMIN_PASSWORD` | password admin |
| `DATABASE_URL` | connection string Neon |
| `SEED_DEMO` | `1` untuk mengisi data demo saat database masih kosong |

4. **Deploy.** Tabel dan data demo dibuat otomatis pada permintaan pertama.

File statis (HTML, CSS, JS) dilayani dari folder `public/`, sesuai aturan Vercel.

## Struktur
```
index.js           titik masuk Vercel (mengekspor app Express)
bin/start.js       menjalankan server lokal
src/app.js         susunan middleware dan route
src/db.js          pg atau PGlite dengan antarmuka yang sama
src/schema.js      skema tabel
src/seed.js        akun awal dan data demo
src/auth.js        JWT dan pembatasan peran
src/routes/        session, products, sales, reports, users
public/            antarmuka (index.html, app.js, style.css)
test/              tes API
```

## Pengembangan lanjutan
Pembatasan percobaan login (rate limit), diskon dan pajak, metode pembayaran non-tunai, pemindai barcode, ekspor laporan ke CSV.
