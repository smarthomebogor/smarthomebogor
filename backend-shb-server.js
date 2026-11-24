// ============================================================
// BACKEND Smart Home Bogor — Point 4 Midtrans + Point 5 Biteship
// Cara pakai ada di bawah file ini. JANGAN taruh file ini di GitHub Pages,
// karena GitHub Pages cuma bisa HTML, tidak bisa jalanin backend.
// Deploy file ini ke Railway / Render / Vercel (gratis).
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const app = express();
app.use(cors());
app.use(express.json());

// --- 1. CONFIG DARI .env (JANGAN TULIS KEY LANGSUNG DI SINI) ---
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY; // dari dashboard Midtrans
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;
const BITESHIP_API_KEY = process.env.BITESHIP_API_KEY; // dari dashboard Biteship
const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true'; // false = SANDBOX dulu

// --- 2. SETUP MIDTRANS SNAP ---
const snap = new midtransClient.Snap({
  isProduction: IS_PRODUCTION,
  serverKey: MIDTRANS_SERVER_KEY,
  clientKey: MIDTRANS_CLIENT_KEY
});

// --- 3. CEK SERVER JALAN ---
app.get('/', (req,res)=> res.json({ ok:true, msg:'Backend SHB jalan. Mode: ' + (IS_PRODUCTION?'PRODUCTION':'SANDBOX') }));

// --- 4. POINT 5: CEK ONGKIR (BITESHIP) ---
// Frontend kirim: { origin_postal_code, destination_postal_code, couriers, items }
// Contoh: origin 16100 (Bogor), destination 12190 (Jakarta), couriers: "jne,jnt,sicepat"
app.post('/api/ongkir', async (req,res)=>{
  try{
    const { origin_postal_code, destination_postal_code, couriers, items } = req.body;
    const r = await fetch('https://api.biteship.com/v1/rates/couriers', {
      method:'POST',
      headers:{ 'Authorization': BITESHIP_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ origin_postal_code, destination_postal_code, couriers, items })
    });
    const data = await r.json();
    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// --- 5. POINT 4: BUAT PEMBAYARAN (MIDTRANS SNAP) ---
// Frontend kirim: { invoice, total, nama, hp, email, alamat }
app.post('/api/bayar', async (req,res)=>{
  try{
    const { invoice, total, nama, hp, email } = req.body;
    const parameter = {
      transaction_details: { order_id: invoice, gross_amount: total },
      customer_details: { first_name: nama, phone: hp, email: email || 'customer@smarthomebogor.id' },
      // Midtrans akan kirim status ke sini kalau sudah bayar:
      // callbacks: { finish: 'https://web-kamu.com/sukses' }
    };
    const transaction = await snap.createTransaction(parameter);
    // transaction.token & transaction.redirect_url -> kirim ke frontend
    res.json(transaction);
  }catch(e){ res.status(500).json({ error: e.message }); }
});

// --- 6. WEBHOOK: MIDTRANS KASIH TAU KALAU UDAH LUNAS ---
// Masuk ke Dashboard Midtrans > Settings > Configuration > Payment Notification URL:
// isi dengan: https://domain-backend-kamu.com/api/webhook-midtrans
app.post('/api/webhook-midtrans', async (req,res)=>{
  try{
    const status = await snap.transaction.notification(req.body);
    console.log('STATUS BAYAR:', status.order_id, status.transaction_status);
    // DI SINI: kalau status.transaction_status == 'settlement' / 'capture'
    // -> update pesanan di database jadi LUNAS, kirim WA ke customer
    // Untuk sekarang cuma log dulu.
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Backend jalan di port ' + PORT));
/*
============================================================
CARA PAKAI (BACA SAMPAI HABIS):
============================================================
1. Di laptop, buat folder baru: backend-shb
   Copy file ini ke sana jadi server.js

2. Buka Terminal di folder itu, ketik:
   npm init -y
   npm install express cors midtrans-client dotenv

3. Buat file .env (file baru, tanpa nama depan):
   MIDTRANS_SERVER_KEY=SB-Mid-server-xxxx
   MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx
   MIDTRANS_IS_PRODUCTION=false
   BITESHIP_API_KEY=biteship_test_xxxx
   PORT=3000

4. Jalankan:
   node server.js
   Kalau muncul "Backend jalan di port 3000" = BERHASIL.

5. Test di browser:
   http://localhost:3000/
   http://localhost:3000/api/ongkir (pakai Postman / Thunder Client)

6. Kalau sudah jalan lokal, baru deploy ke Railway / Render
   biar bisa diakses dari web GitHub Pages kamu.

7. Di file index_34.html, ubah SHB_CONFIG:
   MODE: "API"
   ENDPOINT_ONGKIR: "https://backend-kamu.railway.app/api/ongkir"
   ENDPOINT_BAYAR: "https://backend-kamu.railway.app/api/bayar"

PENTING:
- Key yang depannya SB-Mid- = SANDBOX (uang pura-pura, buat latihan).
- Key PRODUCTION baru dipakai kalau sudah siap jualan beneran.
- File .env JANGAN di-upload ke GitHub. Masukkan .env ke .gitignore.
*/
