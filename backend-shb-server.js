// Backend Smart Home Bogor: iPaymu Redirect Payment + Biteship (ongkir & lacak)
// Deploy ke Railway/Render. Jangan di GitHub Pages. Lihat README.md untuk langkahnya.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const P = require('./pricing');


const {
  IPAYMU_VA, IPAYMU_API_KEY, IPAYMU_BASE_URL, IPAYMU_CALLBACK_URL, IPAYMU_RETURN_URL, IPAYMU_CANCEL_URL, BITESHIP_API_KEY,
  ALLOWED_ORIGINS, DATA_DIR, ORIGIN_POSTAL_CODE = '16100', ADMIN_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  MIN_SUBTOTAL = '100000', MAX_SUBTOTAL = '200000000', PORT = 3000
} = process.env;
const IPAYMU_URL = IPAYMU_BASE_URL || 'https://sandbox.ipaymu.com/api/v2';

for (const k of ['IPAYMU_VA', 'IPAYMU_API_KEY', 'BITESHIP_API_KEY']) {
  if (!process.env[k]) console.warn(`PERINGATAN: ${k} belum diisi di environment.`);
}

if (!ADMIN_TOKEN) console.warn('INFO: ADMIN_TOKEN belum diisi, endpoint admin nonaktif.');
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) console.warn('INFO: Telegram belum diisi, notifikasi pesanan ke pemilik nonaktif.');

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

// Tabel harga, zona, kurir ada di pricing.js (server yang menentukan, klien tidak).
const { KURIR, PAY, InputError } = P;
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

// --- Notifikasi ke pemilik (Telegram, opsional) ---
async function notify(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: String(text).slice(0, 3500) }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) { console.error('notify:', e.message); }
}
const rp = n => 'Rp' + Number(n || 0).toLocaleString('id-ID');
function ringkasOrder(o) {
  const brg = Object.keys(o.items || {}).map(k => `${P.NAMA[k]} x${o.items[k]}`).join(', ');
  return `${o.invoice}\n${o.nama} | ${o.hp}\n${o.alamat} (${o.kota}${o.kodepos ? ' ' + o.kodepos : ''})\n${brg}\nPemasangan: ${o.install === 'technician' ? 'Teknisi Datang' : 'Pasang Sendiri'} | Kurir: ${o.kurir}\nTotal: ${rp(o.total)}`;
}

// --- Tarif asli Biteship untuk kurir terpilih. null = pakai estimasi zona ---
const BITESHIP_MAP = { 'jne-reg': ['jne', 'reg'], jnt: ['jnt', null], sicepat: ['sicepat', 'best'], anteraja: ['anteraja', 'reg'] };
async function ongkirBiteship(kurirId, kodepos, beratKg, nilai) {
  const m = BITESHIP_MAP[kurirId];
  if (!m || !BITESHIP_API_KEY || !/^\d{5}$/.test(kodepos || '') || !/^\d{5}$/.test(ORIGIN_POSTAL_CODE)) return null;
  try {
    const r = await fetch('https://api.biteship.com/v1/rates/couriers', {
      method: 'POST', headers: { Authorization: BITESHIP_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin_postal_code: ORIGIN_POSTAL_CODE, destination_postal_code: kodepos, couriers: m[0],
        items: [{ name: 'Paket Smart Home', value: Math.max(0, nilai), weight: Math.round(beratKg * 1000), quantity: 1 }]
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return null;
    const j = await r.json();
    const harga = (j.pricing || [])
      .filter(p => String(p.courier_code).toLowerCase() === m[0] && (!m[1] || String(p.courier_service_code).toLowerCase() === m[1]))
      .map(p => Number(p.price)).filter(n => Number.isFinite(n) && n > 0);
    return harga.length ? Math.min(...harga) : null;
  } catch (e) { console.error('biteship rate:', e.message); return null; }
}

// Satu fungsi untuk pratinjau (/api/hitung) dan pembuatan pesanan (/api/bayar), jadi angkanya selalu sama.
async function hitungPesanan(b) {
  const d = P.hitungDasar(b, { minSubtotal: +MIN_SUBTOTAL, maxSubtotal: +MAX_SUBTOTAL });
  const kodepos = str(b.kodepos, 5);
  let ongkir = 0, sumber = 'tidak_ada';
  if (!d.kurir.teknisi) {
    const asli = await ongkirBiteship(d.kurirId, kodepos, d.berat, d.subtotal);
    ongkir = asli != null ? asli : d.ongkirEstimasi;
    sumber = asli != null ? 'biteship' : 'estimasi_zona';
  }
  const fee = d.pay.fee(d.subtotal + d.jasaTeknisi + ongkir);
  return {
    ...d, kodepos: /^\d{5}$/.test(kodepos) ? kodepos : '', ongkir, ongkir_sumber: sumber, fee,
    total: d.subtotal + d.jasaTeknisi + ongkir + fee
  };
}
const publik = h => ({
  items: h.items, subtotal: h.subtotal, jasa_teknisi: h.jasaTeknisi, ongkir: h.ongkir, ongkir_sumber: h.ongkir_sumber,
  fee: h.fee, total: h.total, install: h.install, kurir: h.kurirId, pay: h.payId
});
const handle = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof InputError) return bad(res, e.message);
    console.error(req.path + ':', e.message); bad(res, 'Terjadi kesalahan di server.', 500);
  }
};

// Pratinjau total (tanpa membuat pesanan)
app.post('/api/hitung', limit(60, 60000), handle(async (req, res) => {
  const h = await hitungPesanan(req.body);
  res.json({ ...publik(h), opsi_kurir: P.opsiKurir(h.kota, h.berat, h.install) });
}));

// --- Buat pesanan + pembayaran ---
// Klien hanya kirim pilihan (items, install, kota, kodepos, berat, kurir, pay) + data penerima. Semua nominal dihitung di server.
app.post('/api/bayar', limit(10, 60000), handle(async (req, res) => {
  const b = req.body;
  const nama = str(b.nama, 60), hp = str(b.hp, 20).replace(/[^\d+]/g, ''), alamat = str(b.alamat, 300);
  if (!nama || hp.length < 8 || !alamat) return bad(res, 'Nama, WhatsApp, dan alamat wajib diisi.');
  const h = await hitungPesanan(b);
  const cod = !!h.pay.cod;
  const invoice = 'SHB-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

  const order = {
    invoice, nama, hp, alamat, kota: b.kota, kodepos: h.kodepos, kurir: b.kurir, pay: b.pay, install: h.install,
    items: h.items, subtotal: h.subtotal, jasa_teknisi: h.jasaTeknisi, ongkir: h.ongkir, ongkir_sumber: h.ongkir_sumber,
    fee: h.fee, total: h.total, status: cod ? 'cod_menunggu_jadwal' : 'menunggu_bayar', dibuat: new Date().toISOString()
  };
  orders[invoice] = order; save();

  if (cod) {
    notify('PESANAN COD BARU\n' + ringkasOrder(order));
    return res.json({ invoice, total: h.total, ongkir: h.ongkir, fee: h.fee, cod: true });
  }

  if (!IPAYMU_VA || !IPAYMU_API_KEY) throw new Error('Konfigurasi iPaymu belum lengkap di Railway.');
  const callbackUrl = IPAYMU_CALLBACK_URL || 'https://smarthomebogor-production.up.railway.app/api/webhook-ipaymu';
  const returnUrl = IPAYMU_RETURN_URL || 'https://smarthomebogor.my.id/?payment=return';
  const cancelUrl = IPAYMU_CANCEL_URL || 'https://smarthomebogor.my.id/?payment=cancel';
  const payload = {
    product: ['Pesanan Smart Home Bogor'], qty: ['1'], price: [String(h.total)], description: ['Pesanan ' + invoice],
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
    order.status = 'gagal_buat_pembayaran'; save();
    return bad(res, 'Gagal membuat pembayaran. Coba lagi atau hubungi kami lewat WhatsApp.', 502);
  }
  order.ipaymu_session = result.Data.SessionID || null;
  order.ipaymu_transaction_id = result.Data.TransactionId || null;
  save();
  res.json({ invoice, total: h.total, ongkir: h.ongkir, fee: h.fee, payment_url: result.Data.Url, provider: 'ipaymu' });
}));

// Cek status pesanan (invoice acak, jadi tidak mudah ditebak). Data pribadi tidak dikembalikan.
app.get('/api/status/:invoice', limit(30, 60000), (req, res) => {
  const o = orders[str(req.params.invoice, 40)];
  if (!o) return bad(res, 'Pesanan tidak ditemukan.', 404);
  res.json({ invoice: o.invoice, status: o.status, total: o.total, resi: o.resi || null });
});

// --- Admin sederhana (aktif hanya jika ADMIN_TOKEN diisi). Pakai header: Authorization: Bearer <ADMIN_TOKEN> ---
const STATUS_ADMIN = ['menunggu_bayar', 'lunas', 'cod_menunggu_jadwal', 'dijadwalkan', 'dikirim', 'selesai', 'dibatalkan'];
function adminOnly(req, res, next) {
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 16) return bad(res, 'Tidak ditemukan.', 404);
  const got = Buffer.from(String(req.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(ADMIN_TOKEN);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return bad(res, 'Tidak diizinkan.', 401);
  next();
}
app.get('/api/admin/orders', limit(30, 60000), adminOnly, (req, res) => {
  const st = str(req.query.status, 40);
  const list = Object.values(orders).filter(o => !st || o.status === st).sort((a, b) => (b.dibuat || '').localeCompare(a.dibuat || ''));
  res.json({ jumlah: list.length, orders: list });
});
app.post('/api/admin/orders/:invoice/status', limit(30, 60000), adminOnly, (req, res) => {
  const o = orders[str(req.params.invoice, 40)];
  if (!o) return bad(res, 'Pesanan tidak ditemukan.', 404);
  const status = str(req.body.status, 40);
  if (status) {
    if (!STATUS_ADMIN.includes(status)) return bad(res, 'Status tidak valid.');
    o.status = status;
  }
  if (req.body.resi != null) o.resi = str(req.body.resi, 40);
  o.diperbarui = new Date().toISOString(); save();
  res.json({ ok: true, order: o });
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
    const SUDAH = ['lunas', 'dijadwalkan', 'dikirim', 'selesai', 'dibatalkan'];
    if (!SUDAH.includes(o.status) && next !== o.status) {
      o.status = next; o.ipaymu_trx_id = String(req.body.trx_id || '');
      o.diperbarui = new Date().toISOString(); save();
      console.log('IPAYMU STATUS', invoice, next);
      if (next === 'lunas') notify('PEMBAYARAN LUNAS\n' + ringkasOrder(o));
    }
    return res.status(200).json({ ok: true });
  } catch (e) { console.error('ipaymu webhook:', e.message); return bad(res, 'Webhook error.', 500); }
});

app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: 'Terjadi kesalahan.' }); });
app.listen(PORT, () => console.log('Backend SHB jalan di port ' + PORT + ' | ' + (IPAYMU_URL.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION')));
