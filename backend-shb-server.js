// Backend Smart Home Bogor: iPaymu Redirect Payment + Biteship (ongkir & lacak)
// Deploy ke Railway/Render. Jangan di GitHub Pages. Lihat README.md untuk langkahnya.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');


const {
  IPAYMU_VA, IPAYMU_API_KEY, IPAYMU_BASE_URL, IPAYMU_CALLBACK_URL, IPAYMU_RETURN_URL, IPAYMU_CANCEL_URL, BITESHIP_API_KEY,
  ALLOWED_ORIGINS, DATA_DIR,
  MIN_SUBTOTAL = '100000', MAX_SUBTOTAL = '200000000', PORT = 3000
} = process.env;
const IPAYMU_URL = IPAYMU_BASE_URL || 'https://sandbox.ipaymu.com/api/v2';

for (const k of ['IPAYMU_VA', 'IPAYMU_API_KEY', 'BITESHIP_API_KEY']) {
  if (!process.env[k]) console.warn(`PERINGATAN: ${k} belum diisi di environment.`);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

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
const PAY = {
  qris: { nama: 'iPaymu', fee: () => 0 },
  'va-bca': { nama: 'VA BCA', fee: () => 0 },
  'va-bri': { nama: 'VA BRI', fee: () => 0 },
  gopay: { nama: 'GoPay', fee: () => 0 },
  dana: { nama: 'DANA / OVO', fee: () => 0 },
  kartu: { nama: 'Kartu Kredit / Debit', fee: () => 0 },
  cod: { nama: 'COD (bayar ke teknisi)', fee: () => 0, cod: true }
};
const COURIER_CODES = ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki', 'pos', 'ninja', 'lion', 'idexpress'];

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

app.get('/', (req, res) => res.json({ ok: true, payment: 'iPaymu', mode: IPAYMU_URL.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION' }));

// Konfigurasi pembayaran: redirect checkout iPaymu, tidak ada API key di frontend.
app.get('/api/config', (req, res) => res.json({ paymentProvider: 'ipaymu', mode: IPAYMU_URL.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION' }));

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
// Klien hanya kirim: subtotal, kota, berat, kurir, pay, data penerima. Ongkir & fee dihitung ulang di server.
app.post('/api/bayar', limit(10, 60000), async (req, res) => {
  try {
    const b = req.body;
    const nama = str(b.nama, 60), hp = str(b.hp, 20).replace(/[^\d+]/g, ''), alamat = str(b.alamat, 300), email = str(b.email, 80);
    const subtotal = Math.round(Number(b.subtotal));
    const berat = Math.min(100, Math.max(1, Number(b.berat) || 1));
    const kurir = KURIR[b.kurir], pay = PAY[b.pay], zona = ZONA[b.kota];
    if (!nama || hp.length < 8 || !alamat) return bad(res, 'Nama, WhatsApp, dan alamat wajib diisi.');
    if (!kurir || !pay || !zona) return bad(res, 'Kurir, pembayaran, atau kota tidak valid.');
    if (!Number.isFinite(subtotal) || subtotal < +MIN_SUBTOTAL || subtotal > +MAX_SUBTOTAL) return bad(res, 'Subtotal tidak valid.');
    if (pay.cod && !kurir.teknisi) return bad(res, 'COD hanya untuk Teknisi Datang.');

    const ongkir = kurir.teknisi ? TEKNISI_FEE : Math.round(kurir.dasar * zona * Math.max(1, berat / 2));
    const fee = pay.fee(subtotal + ongkir);
    const total = subtotal + ongkir + fee;
    const invoice = 'SHB-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

    const order = { invoice, nama, hp, alamat, kota: b.kota, kurir: b.kurir, pay: b.pay, subtotal, ongkir, fee, total, status: pay.cod ? 'cod_menunggu_jadwal' : 'menunggu_bayar', dibuat: new Date().toISOString() };
    orders[invoice] = order; save();

    if (pay.cod) return res.json({ invoice, total, ongkir, fee, cod: true });

    if (!IPAYMU_VA || !IPAYMU_API_KEY) throw new Error('Konfigurasi iPaymu belum lengkap di Railway.');
    const callbackUrl = IPAYMU_CALLBACK_URL || 'https://smarthomebogor-production.up.railway.app/api/webhook-ipaymu';
    const returnUrl = IPAYMU_RETURN_URL || 'https://smarthomebogor.my.id/?payment=return';
    const cancelUrl = IPAYMU_CANCEL_URL || 'https://smarthomebogor.my.id/?payment=cancel';
    const payload = {
      product: ['Pesanan Smart Home Bogor'],
      qty: ['1'],
      price: [String(total)],
      description: ['Pesanan ' + invoice],
      returnUrl, cancelUrl, notifyUrl: callbackUrl, referenceId: invoice
    };
    const bodyJson = JSON.stringify(payload);
    const bodyHash = crypto.createHash('sha256').update(bodyJson).digest('hex');
    const stringToSign = `POST:${IPAYMU_VA}:${bodyHash}:${IPAYMU_API_KEY}`;
    const signature = crypto.createHmac('sha256', IPAYMU_API_KEY).update(stringToSign).digest('hex');
    const apiRes = await fetch(`${IPAYMU_URL}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', va: IPAYMU_VA, signature, timestamp: new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) },
      body: bodyJson
    });
    const result = await apiRes.json();
    if (!apiRes.ok || result.Status !== 200 || !result.Data || !result.Data.Url) {
      console.error('iPaymu create payment failed:', result);
      throw new Error(result.Message || 'iPaymu gagal membuat pembayaran.');
    }
    order.ipaymu_session = result.Data.SessionID || null;
    order.ipaymu_transaction_id = result.Data.TransactionId || null;
    save();
    res.json({ invoice, total, ongkir, fee, payment_url: result.Data.Url, provider: 'ipaymu' });
  } catch (e) { console.error('bayar:', e.message); bad(res, 'Gagal membuat pembayaran.', 500); }
});

// Cek status pesanan (invoice acak, jadi tidak mudah ditebak). Data pribadi tidak dikembalikan.
app.get('/api/status/:invoice', limit(30, 60000), (req, res) => {
  const o = orders[str(req.params.invoice, 40)];
  if (!o) return bad(res, 'Pesanan tidak ditemukan.', 404);
  res.json({ invoice: o.invoice, status: o.status, total: o.total });
});

// --- Webhook iPaymu: validasi HMAC-SHA256 + idempotensi ---
function normalizeIpaymuCallback(raw) {
  const out = {};
  for (const key of Object.keys(raw || {})) {
    const value = raw[key];
    if (['trx_id', 'status_code', 'transaction_status_code', 'paid_off'].includes(key)) out[key] = parseInt(value, 10);
    else if (key === 'is_escrow') out[key] = value === true || value === 'true' || value === '1' || value === 1;
    else if (key === 'additional_info') out[key] = value === '[]' ? [] : value;
    else out[key] = value == null ? null : String(value);
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'additional_info')) out.additional_info = [];
  delete out.signature;
  return Object.keys(out).sort((a,b) => a.localeCompare(b)).reduce((a,k) => (a[k] = out[k], a), {});
}
app.post('/api/webhook-ipaymu', (req, res) => {
  try {
    if (!IPAYMU_VA) return bad(res, 'Konfigurasi callback belum lengkap.', 500);
    const payload = normalizeIpaymuCallback(req.body || {});
    let jsonBody = JSON.stringify(payload).replace(/\//g, '\\/');
    const expected = crypto.createHmac('sha256', IPAYMU_VA).update(jsonBody).digest('hex');
    const received = String(req.get('X-Signature') || req.body.signature || '');
    const a = Buffer.from(received), b = Buffer.from(expected);
    if (!received || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return bad(res, 'Signature iPaymu tidak valid.', 401);

    const invoice = str(req.body.reference_id || req.body.referenceId, 60);
    const o = orders[invoice];
    if (!o) return res.json({ ok: true, ignored: true });
    const paidTotal = Number(req.body.total || req.body.amount || 0);
    if (!Number.isFinite(paidTotal) || paidTotal !== Number(o.total)) return bad(res, 'Nominal callback tidak cocok.', 400);
    const statusCode = Number(req.body.status_code);
    const statusText = String(req.body.status || '').toLowerCase();
    let next = o.status;
    if (statusCode === 1 && statusText === 'berhasil') next = 'lunas';
    else if (statusCode === -2 || statusText === 'expired') next = 'gagal_expired';
    else if (statusCode === 0 || statusText === 'pending') next = 'menunggu_bayar';
    if (o.status !== 'lunas' && next !== o.status) {
      o.status = next; o.ipaymu_trx_id = String(req.body.trx_id || '');
      o.diperbarui = new Date().toISOString(); save();
      console.log('IPAYMU STATUS', invoice, next);
    }
    return res.status(200).json({ ok: true });
  } catch (e) { console.error('ipaymu webhook:', e.message); return bad(res, 'Webhook error.', 500); }
});

app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: 'Terjadi kesalahan.' }); });
app.listen(PORT, () => console.log('Backend SHB jalan di port ' + PORT + ' | ' + (IPAYMU_URL.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION')));
