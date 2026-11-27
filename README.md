# Smart Home Bogor

Website konfigurator smart home. Frontend statis di GitHub Pages (`index.html`), backend Node.js di Railway (`backend-shb-server.js`).

## Deploy backend (Railway)
1. Push repo ke GitHub. Pastikan `.env` TIDAK ikut ter-commit (sudah ada di `.gitignore`).
2. Di Railway, buat service dari repo ini. Start command: `npm start`.
3. Isi Variables sesuai `.env.example`. DOKU dapat diuji dengan key sandbox. Untuk ongkir aktual, isi `BITESHIP_API_KEY` dengan token `biteship_live....` dari Biteship (token `biteship_test` akan ditolak untuk checkout).
4. Tambahkan Volume, mount ke `/data`, dan set `DATA_DIR=/data` supaya pesanan tidak hilang saat redeploy.
5. DOKU Dashboard Sandbox > Notification URL: `https://smarthomebogor-production.up.railway.app/api/webhook-doku`
6. Tes `https://<domain-railway>/api/config` dan alur bayar di sandbox. Jika semua lancar, ganti ke key production dan `DOKU_BASE_URL=https://api.doku.com`.

## Endpoint
`GET /api/config` | `POST /api/hitung` (pratinjau total) | `POST /api/ongkir` | `GET /api/lacak?resi=&kurir=` | `POST /api/bayar` | `GET /api/status/:invoice` | `POST /api/webhook-doku`
Admin (butuh `Authorization: Bearer <ADMIN_TOKEN>`): `GET /api/admin/orders?status=` | `POST /api/admin/orders/:invoice/status` dengan body `{"status":"dijadwalkan","resi":"..."}`

## Biteship (ongkir & lacak)
Semua kode Biteship ada di satu file: `biteship.js`. Server hanya memanggil tiga fungsi:
- `biteship.cekTarif(...)` untuk `/api/ongkir` (hasil dirapikan, di-cache 5 menit, kode pos asal selalu dari server)
- `biteship.ongkirUntuk(kurirId, kodepos, beratKg, nilai)` untuk total checkout (wajib tarif aktual; gagal berarti checkout ditahan, tanpa estimasi zona)
- `biteship.lacak(resi, kurir)` untuk `/api/lacak`

Mau tambah kurir? Ubah `KURIR_BOLEH` atau `PETA_KURIR` di `biteship.js`, dan tambahkan tarif dasarnya di `KURIR` pada `pricing.js`.
Pasang `BITESHIP_API_KEY` sebagai Secret di platform tempat backend jalan. `npm test` menjalankan tes Biteship memakai fetch tiruan, tanpa key asli.

## Catatan
- Semua nominal dihitung di server (`pricing.js`): harga perangkat, jasa teknisi, ongkir, dan biaya admin. Browser hanya mengirim pilihan (jumlah perangkat, mode pasang, kota, kode pos, kurir). **Jika harga perangkat di frontend berubah, ubah juga `HARGA` di `pricing.js`.** Jalankan `npm test` untuk memastikan harga paket di situs masih sama dengan jumlah satuan ditambah jasa teknisi.
- Ongkir kurir wajib memakai tarif aktual Biteship dan kode pos tujuan 5 digit. Jika Biteship gagal, API Key bukan LIVE, atau tarif tidak tersedia, checkout dihentikan—tidak ada estimasi ongkir palsu.
- Teknisi Datang hanya untuk Jabodetabek. Pemasangan oleh teknisi memakai kurir "Teknisi Datang", sedangkan Pasang Sendiri memakai kurir ekspedisi.
- Notifikasi pesanan COD dan pembayaran lunas dikirim ke Telegram jika `TELEGRAM_*` diisi.
- `orders.json` hanya penyimpanan sederhana. Untuk pesanan banyak, pindah ke database (Postgres di Railway).
