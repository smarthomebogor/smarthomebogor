# Smart Home Bogor Backend

Backend Node.js untuk dua alur transaksi Smart Home Bogor. Deploy folder ini ke Railway. Jangan menaruh secret di HTML atau repository publik.

## Konfigurasi Railway

Buat variables berikut di Railway (bukan di file HTML):

- `IPAYMU_VA` dan `IPAYMU_API_KEY` dari dashboard iPaymu Sandbox.
- `IPAYMU_BASE_URL=https://sandbox.ipaymu.com/api/v2` untuk pengujian.
- `IPAYMU_CALLBACK_URL=https://smarthomebogor-production.up.railway.app/api/webhook-ipaymu`
- `IPAYMU_RETURN_URL=https://smarthomebogor.my.id/?payment=return`
- `IPAYMU_CANCEL_URL=https://smarthomebogor.my.id/?payment=cancel`
- `BITESHIP_API_KEY` dengan token LIVE untuk tarif pengiriman asli.
- `ORIGIN_POSTAL_CODE` sesuai kode pos gudang pengiriman.
- `COMPONENT_DEFAULT_WEIGHT_GRAM` berat awal komponen dalam gram; sesuaikan dengan paket rata-rata.
- `ALLOWED_ORIGINS=https://smarthomebogor.my.id,https://www.smarthomebogor.my.id`
- `DATA_DIR=/data` jika Railway Volume sudah dipasang.
- `ADMIN_TOKEN` token acak minimal 16 karakter untuk endpoint admin.
- `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` opsional untuk notifikasi admin.

Daftarkan callback iPaymu Sandbox di dashboard sebagai `https://smarthomebogor-production.up.railway.app/api/webhook-ipaymu` dan pilih callback content type JSON. Untuk Production, gunakan VA/API Key Production, ganti `IPAYMU_BASE_URL` menjadi `https://my.ipaymu.com/api/v2`, dan pastikan IP server serta domain telah divalidasi oleh iPaymu.

## Dua alur checkout

### Pembelian komponen satuan
1. Pelanggan memilih komponen, mengisi alamat, kode pos, dan berat total paket setelah dikemas.
2. Backend mengambil tarif aktual dari Biteship LIVE (JNE, J&T, SiCepat, AnterAja).
3. Pelanggan memilih layanan kurir.
4. Backend membuat pembayaran redirect iPaymu untuk subtotal komponen + ongkir.
5. Pesanan berubah menjadi `lunas` setelah callback iPaymu tervalidasi.

### Paket Smart Home
1. Pelanggan memilih perangkat/paket di konfigurator.
2. Jasa pemasangan sudah termasuk harga paket; tidak ada biaya instalasi tambahan di checkout.
3. Pelanggan mengajukan alamat dan preferensi jadwal.
4. Backend menyimpan pesanan sebagai `menunggu_pemasangan`; tidak ada permintaan pembayaran di awal.
5. Pembayaran dilakukan setelah teknisi selesai memasang dan menguji perangkat. Setelah pemasangan, admin mengubah status menjadi `menunggu_pembayaran_setelah_instalasi`, lalu dapat membuat tautan iPaymu melalui `POST /api/admin/orders/:invoice/payment` (header `Authorization: Bearer ADMIN_TOKEN`) dan mengirim tautan tersebut ke pelanggan.

## Endpoint backend

- `GET /api/config`
- `POST /api/paket/hitung`
- `POST /api/paket/pesan`
- `POST /api/komponen/ongkir`
- `POST /api/komponen/bayar`
- `POST /api/webhook-ipaymu`
- `GET /api/status/:invoice`
- `GET /api/lacak?resi=&kurir=`
- `GET /api/admin/orders` (butuh `ADMIN_TOKEN`)
- `POST /api/admin/orders/:invoice/status` (butuh `ADMIN_TOKEN`)
- `POST /api/admin/orders/:invoice/payment` (buat tautan bayar paket setelah pemasangan; butuh `ADMIN_TOKEN`)
