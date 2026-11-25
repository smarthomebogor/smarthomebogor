# Smart Home Bogor

Website konfigurator smart home. Frontend statis di GitHub Pages (`index.html`), backend Node.js di Railway (`backend-shb-server.js`).

## Deploy backend (Railway)
1. Push repo ke GitHub. Pastikan `.env` TIDAK ikut ter-commit (sudah ada di `.gitignore`).
2. Di Railway, buat service dari repo ini. Start command: `npm start`.
3. Isi Variables sesuai `.env.example`. Pakai key SANDBOX dulu (`SB-Mid-...`, `biteship_test_...`).
4. Tambahkan Volume, mount ke `/data`, dan set `DATA_DIR=/data` supaya pesanan tidak hilang saat redeploy.
5. iPaymu Sandbox Dashboard > Integrasi > Callback URL: `https://smarthomebogor-production.up.railway.app/api/webhook-ipaymu`
6. Tes `https://<domain-railway>/api/config` dan alur bayar di sandbox. Jika semua lancar, ganti ke key production dan `MIDTRANS_IS_PRODUCTION=true`.

## Endpoint
`GET /api/config` | `POST /api/ongkir` | `GET /api/lacak?resi=&kurir=` | `POST /api/bayar` | `GET /api/status/:invoice` | `POST /api/webhook-ipaymu`

## Catatan
- Ongkir dan biaya admin dihitung ulang di server. Subtotal konfigurator masih dikirim dari browser (dibatasi `MIN_SUBTOTAL`/`MAX_SUBTOTAL`), jadi nominal akhir tetap diverifikasi admin sebelum pengerjaan.
- `orders.json` hanya penyimpanan sederhana. Untuk pesanan banyak, pindah ke database (Postgres di Railway).
