# Smart Home Bogor

Website konfigurator smart home. Frontend statis di GitHub Pages (`index.html`), backend Node.js di Railway (`backend-shb-server.js`).

## Deploy backend (Railway)
1. Push repo ke GitHub. Pastikan `.env` TIDAK ikut ter-commit (sudah ada di `.gitignore`).
2. Di Railway, buat service dari repo ini. Start command: `npm start`.
3. Isi Variables sesuai `.env.example`. Pakai key SANDBOX dulu (Client ID DOKU sandbox, `biteship_test_...`).
4. Tambahkan Volume, mount ke `/data`, dan set `DATA_DIR=/data` supaya pesanan tidak hilang saat redeploy.
5. DOKU Dashboard Sandbox > Notification URL: `https://smarthomebogor-production.up.railway.app/api/webhook-doku`
6. Tes `https://<domain-railway>/api/config` dan alur bayar di sandbox. Jika semua lancar, ganti ke key production dan `DOKU_BASE_URL=https://api.doku.com`.

## Endpoint
`GET /api/config` | `POST /api/hitung` (pratinjau total) | `POST /api/ongkir` | `GET /api/lacak?resi=&kurir=` | `POST /api/bayar` | `GET /api/status/:invoice` | `POST /api/webhook-doku`
Admin (butuh `Authorization: Bearer <ADMIN_TOKEN>`): `GET /api/admin/orders?status=` | `POST /api/admin/orders/:invoice/status` dengan body `{"status":"dijadwalkan","resi":"..."}`

## Catatan
- Semua nominal dihitung di server (`pricing.js`): harga perangkat, jasa teknisi, ongkir, dan biaya admin. Browser hanya mengirim pilihan (jumlah perangkat, mode pasang, kota, kode pos, kurir). **Jika harga perangkat di frontend berubah, ubah juga `HARGA` di `pricing.js`.** Jalankan `npm test` untuk memastikan harga paket di situs masih sama dengan jumlah satuan ditambah jasa teknisi.
- Ongkir kurir memakai tarif asli Biteship jika kode pos tujuan diisi dan `BITESHIP_API_KEY` valid. Jika Biteship gagal atau kode pos kosong, server memakai estimasi per zona.
- Teknisi Datang hanya untuk Jabodetabek. Pemasangan oleh teknisi memakai kurir "Teknisi Datang", sedangkan Pasang Sendiri memakai kurir ekspedisi.
- Notifikasi pesanan COD dan pembayaran lunas dikirim ke Telegram jika `TELEGRAM_*` diisi.
- `orders.json` hanya penyimpanan sederhana. Untuk pesanan banyak, pindah ke database (Postgres di Railway).
