// Backend Smart Home Bogor: Midtrans Snap + Biteship (ongkir & lacak)
// Deploy ke Railway/Render. Jangan di GitHub Pages. Lihat README.md untuk langkahnya.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');

const {
  MIDTRANS_SERVER_KEY, MIDTRANS_CLIENT_KEY, BITESHIP_API_KEY,
  MIDTRANS_IS_PRODUCTION, ALLOWED_ORIGINS, DATA_DIR,
  MIN_SUBTOTAL = '100000', MAX_SUBTOTAL = '200000000', PORT = 3000
} = process.env;
const IS_PRODUCTION = MIDTRANS_IS_PRODUCTION === 'true';

for (const k of ['MIDTRANS_SERVER_KEY', 'MIDTRANS_CLIENT_KEY', 'BITESHIP_API_KEY']) {
  if (!process.env[k]) console.warn(`PERINGATAN: ${k} belum diisi di environment.`);
}

const snap = new midtransClient.Snap({
  isProduction: IS_PRODUCTION, serverKey: MIDTRANS_SERVER_KEY, clientKey: MIDTRANS_CLIENT_KEY
});

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));

// --- CORS: hanya domain toko kamu ---
const allowed = (ALLOWED_ORIGINS || 'https://smarthomebogor.my.id,https://www.smarthomebogor.my.id')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => (!origin || allowed.includes(origin)) ? cb(null, true) : cb(new Error('Origin tidak diizinkan')),
  methods: ['GET', 'POST']
}));

// --- Rate limit sederhana (per IP, di memori) ---
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path, now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Terlalu banyak permintaan, coba lagi sebentar.' });
    arr.push(now); hits.set(key, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 600000)) hits.delete(k); }, 600000).unref();

// --- Penyimpanan pesanan (file JSON). Di Railway pasang Volume dan set DATA_DIR=/data ---
const DIR = DATA_DIR || __dirname;
const DB_FILE = path.join(DIR, 'orders.json');
let orders = {};
try { orders = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (_) {}
function save() {
  try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(orders, null, 2)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }
  catch (e) { console.error('Gagal simpan orders:', e.message); }
}

// --- Tabel harga di SERVER (klien tidak boleh menentukan ongkir/biaya admin) ---
const ZONA = { bogor: 1, 'kab-bogor': 1, depok: 1.5, jakarta: 1.5, bekasi: 1.5, tangerang: 1.5, bandung: 2.2, luar: 2.5 };
const KURIR = {
  'jne-reg': { nama: 'JNE REG', dasar: 12000 }, jnt: { nama: 'J&T Express', dasar: 11000 },
  sicepat: { nama: 'SiCepat BEST', dasar: 13000 }, anteraja: { nama: 'AnterAja Reguler', dasar: 10000 },
  teknisi: { nama: 'Teknisi Datang', dasar: 0, teknisi: true }
};
const TEKNISI_FEE = 1500000;
// Harga resmi perangkat: sumber kebenaran ada di backend, bukan dari browser.
const PRODUCT_CATALOG = {
  lampu: { name: 'Lampu Smart WiFi', price: 275000 },
  plug: { name: 'Smart Plug', price: 225000 },
  sensor: { name: 'Sensor Gerak', price: 350000 },
  lock: { name: 'Smart Lock', price: 1250000 },
  cctv: { name: 'CCTV + Doorbell', price: 1750000 },
  speaker: { name: 'Speaker Voice', price: 450000 }
};
const INSTALL_MODES = { technician: TEKNISI_FEE, diy: 0 };
const PAY = {
  qris: { nama: 'QRIS', fee: s => Math.round(s * 0.007), snap: ['other_qris'] },
  'va-bca': { nama: 'VA BCA', fee: () => 4000, snap: ['bca_va'] },
  'va-bri': { nama: 'VA BRI', fee: () => 4000, snap: ['bri_va'] },
  gopay: { nama: 'GoPay', fee: s => Math.round(s * 0.02), snap: ['gopay'] },
  dana: { nama: 'DANA / OVO', fee: s => Math.round(s * 0.015) },
  kartu: { nama: 'Kartu Kredit / Debit', fee: s => Math.round(s * 0.029) + 2000, snap: ['credit_card'] },
  cod: { nama: 'COD (bayar ke teknisi)', fee: () => 0, cod: true }
};
const COURIER_CODES = ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki', 'pos', 'ninja', 'lion', 'idexpress'];

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

app.get('/', (req, res) => res.json({ ok: true, mode: IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX' }));

// Frontend ambil client key publik dari sini (jadi tidak ditulis di HTML)
app.get('/api/config', (req, res) => res.json({
  clientKey: MIDTRANS_CLIENT_KEY || '',
  snapUrl: IS_PRODUCTION ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js'
}));

// --- Cek ongkir (Biteship) ---
app.post('/api/ongkir', limit(30, 60000), async (req, res) => {
  try {
    const origin = str(req.body.origin_postal_code, 5), dest = str(req.body.destination_postal_code, 5);
    if (!/^\d{5}$/.test(origin) || !/^\d{5}$/.test(dest)) return bad(res, 'Kode pos harus 5 digit.');
    const couriers = str(req.body.couriers, 100).split(',').map(s => s.trim().toLowerCase()).filter(c => COURIER_CODES.includes(c));
    if (!couriers.length) return bad(res, 'Kurir tidak valid.');
    const it = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 10).map(i => ({
      name: str(i.name, 80) || 'Paket', value: Math.max(0, parseInt(i.value) || 0),
      weight: Math.min(100000, Math.max(100, parseInt(i.weight) || 1000)), quantity: Math.min(100, Math.max(1, parseInt(i.quantity) || 1))
    }));
    if (!it.length) return bad(res, 'Item kosong.');
    const r = await fetch('https://api.biteship.com/v1/rates/couriers', {
      method: 'POST', headers: { Authorization: BITESHIP_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin_postal_code: origin, destination_postal_code: dest, couriers: couriers.join(','), items: it })
    });
    res.status(r.ok ? 200 : 502).json(await r.json());
  } catch (e) { console.error('ongkir:', e.message); bad(res, 'Gagal cek ongkir.', 500); }
});

// --- Lacak resi (Biteship) ---
app.get('/api/lacak', limit(30, 60000), async (req, res) => {
  try {
    const resi = str(req.query.resi, 40), kurir = str(req.query.kurir, 20).toLowerCase();
    if (!/^[A-Za-z0-9-]{5,40}$/.test(resi) || !COURIER_CODES.includes(kurir)) return bad(res, 'Resi atau kurir tidak valid.');
    const r = await fetch(`https://api.biteship.com/v1/trackings/${encodeURIComponent(resi)}/couriers/${kurir}`, {
      headers: { Authorization: BITESHIP_API_KEY }
    });
    res.status(r.ok ? 200 : 502).json(await r.json());
  } catch (e) { console.error('lacak:', e.message); bad(res, 'Gagal melacak paket.', 500); }
});

// --- Buat pesanan + pembayaran ---
// Klien mengirim jumlah perangkat; harga satuan dan subtotal dihitung ulang di server.
app.post('/api/bayar', limit(10, 60000), async (req, res) => {
  try {
    const b = req.body;
    const nama = str(b.nama, 60), hp = str(b.hp, 20).replace(/[^\d+]/g, ''), alamat = str(b.alamat, 300), email = str(b.email, 80);
    const items = b.items && typeof b.items === 'object' && !Array.isArray(b.items) ? b.items : null;
    const installMode = str(b.installMode, 20);
    if (!items || !Object.keys(items).length || !Object.keys(INSTALL_MODES).includes(installMode)) return bad(res, 'Rincian perangkat atau metode instalasi tidak valid.');
    let deviceSubtotal = 0;
    for (const [key, rawQty] of Object.entries(items)) {
      if (!Object.prototype.hasOwnProperty.call(PRODUCT_CATALOG, key)) return bad(res, 'Ada perangkat yang tidak dikenal.');
      const qty = Number(rawQty);
      if (!Number.isInteger(qty) || qty < 0 || qty > 20) return bad(res, 'Jumlah perangkat tidak valid.');
      deviceSubtotal += PRODUCT_CATALOG[key].price * qty;
    }
    if (!Object.keys(items).some(key => Number(items[key]) > 0)) return bad(res, 'Pilih minimal satu perangkat.');
    const installFee = INSTALL_MODES[installMode];
    const subtotal = deviceSubtotal + installFee;
    const berat = Math.min(100, Math.max(1, Number(b.berat) || 1));
    const kurir = KURIR[b.kurir], pay = PAY[b.pay], zona = ZONA[b.kota];
    if (!nama || hp.length < 8 || !alamat) return bad(res, 'Nama, WhatsApp, dan alamat wajib diisi.');
    if (!kurir || !pay || !zona) return bad(res, 'Kurir, pembayaran, atau kota tidak valid.');
    if (!Number.isFinite(subtotal) || subtotal < +MIN_SUBTOTAL || subtotal > +MAX_SUBTOTAL) return bad(res, 'Subtotal tidak valid.');
    if (pay.cod && !kurir.teknisi) return bad(res, 'COD hanya untuk Teknisi Datang.');

    if (kurir.teknisi && installMode !== 'technician') return bad(res, 'Teknisi Datang hanya tersedia jika memilih instalasi teknisi.');
    const ongkir = kurir.teknisi ? 0 : Math.round(kurir.dasar * zona * Math.max(1, berat / 2));
    const fee = pay.fee(subtotal + ongkir);
    const total = subtotal + ongkir + fee;
    const invoice = 'SHB-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

    const order = { invoice, nama, hp, alamat, kota: b.kota, kurir: b.kurir, pay: b.pay, items: Object.fromEntries(Object.entries(items).filter(([, q]) => Number(q) > 0)), deviceSubtotal, installMode, installFee, subtotal, ongkir, fee, total, status: pay.cod ? 'cod_menunggu_jadwal' : 'menunggu_bayar', dibuat: new Date().toISOString() };
    orders[invoice] = order; save();

    if (pay.cod) return res.json({ invoice, total, ongkir, fee, cod: true });

    const parameter = {
      transaction_details: { order_id: invoice, gross_amount: total },
      item_details: [
        { id: 'paket', price: subtotal, quantity: 1, name: 'Paket Smart Home' },
        { id: 'ongkir', price: ongkir, quantity: 1, name: 'Ongkir / Jasa' },
        { id: 'admin', price: fee, quantity: 1, name: 'Biaya admin' }
      ].filter(i => i.price > 0),
      customer_details: { first_name: nama, phone: hp, email: email || undefined },
      ...(pay.snap ? { enabled_payments: pay.snap } : {})
    };
    const trx = await snap.createTransaction(parameter);
    res.json({ invoice, total, ongkir, fee, token: trx.token, redirect_url: trx.redirect_url });
  } catch (e) { console.error('bayar:', e.message); bad(res, 'Gagal membuat pembayaran.', 500); }
});

// Cek status pesanan (invoice acak, jadi tidak mudah ditebak). Data pribadi tidak dikembalikan.
app.get('/api/status/:invoice', limit(30, 60000), (req, res) => {
  const o = orders[str(req.params.invoice, 40)];
  if (!o) return bad(res, 'Pesanan tidak ditemukan.', 404);
  res.json({ invoice: o.invoice, status: o.status, total: o.total });
});

// --- Webhook Midtrans: verifikasi signature, lalu update status ---
app.post('/api/webhook-midtrans', async (req, res) => {
  try {
    const n = req.body || {};
    const expected = crypto.createHash('sha512')
      .update(`${n.order_id}${n.status_code}${n.gross_amount}${MIDTRANS_SERVER_KEY}`).digest('hex');
    const a = Buffer.from(String(n.signature_key || '')), e = Buffer.from(expected);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return bad(res, 'Signature tidak valid.', 403);

    const o = orders[n.order_id];
    if (!o) return res.json({ ok: true }); // order tidak dikenal, abaikan
    // Ambil status resmi langsung dari Midtrans (jangan percaya isi body saja)
    const st = await snap.transaction.status(n.order_id);
    if (Number(st.gross_amount) !== Number(o.total)) { console.error('Nominal tidak cocok', n.order_id); return bad(res, 'Nominal tidak cocok.', 400); }

    const t = st.transaction_status, fraud = st.fraud_status;
    let status = o.status;
    if (t === 'settlement' || (t === 'capture' && fraud === 'accept')) status = 'lunas';
    else if (['cancel', 'deny', 'expire'].includes(t)) status = 'gagal_' + t;
    else if (t === 'pending') status = 'menunggu_bayar';
    if (o.status !== 'lunas' && status !== o.status) { o.status = status; o.diperbarui = new Date().toISOString(); save(); console.log('STATUS', o.invoice, status); }
    res.json({ ok: true });
  } catch (e) { console.error('webhook:', e.message); bad(res, 'Webhook error.', 500); }
});

app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: 'Terjadi kesalahan.' }); });
app.listen(PORT, () => console.log('Backend SHB jalan di port ' + PORT + ' | ' + (IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX')));
