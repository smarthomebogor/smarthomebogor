// Backend Smart Home Bogor: DOKU Checkout + Biteship (ongkir & lacak)
// Deploy ke Railway/Render. Jangan di GitHub Pages. Lihat README.md untuk langkahnya.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const P = require('./pricing');
const DOKU = require('./doku');
const { createBiteship } = require('./biteship');
const DOKU_CALLBACK_URL = process.env.DOKU_CALLBACK_URL; // halaman tujuan setelah bayar
const DOKU_NOTIFY_URL = process.env.DOKU_NOTIFY_URL;     // URL webhook backend, contoh https://xxx.up.railway.app/api/webhook-doku
const DOKU_NOTIFY_PATH = '/api/webhook-doku';


const {
  BITESHIP_API_KEY,
  ALLOWED_ORIGINS, DATA_DIR, ORIGIN_POSTAL_CODE = '16100', ADMIN_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  MIN_SUBTOTAL = '100000', MAX_SUBTOTAL = '200000000', PORT = 3000
} = process.env;

const biteship = createBiteship({ apiKey: BITESHIP_API_KEY, originPostalCode: ORIGIN_POSTAL_CODE, requireLive: true });

for (const k of ['DOKU_CLIENT_ID', 'DOKU_SECRET_KEY', 'BITESHIP_API_KEY']) {
  if (!process.env[k]) console.warn(`PERINGATAN: ${k} belum diisi di environment.`);
}

if (!ADMIN_TOKEN) console.warn('INFO: ADMIN_TOKEN belum diisi, endpoint admin nonaktif.');
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) console.warn('INFO: Telegram belum diisi, notifikasi pesanan ke pemilik nonaktif.');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));
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

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const handle = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof InputError) return bad(res, e.message);
    console.error(req.path + ':', e.message); bad(res, 'Terjadi kesalahan di server.', 500);
  }
};

const modeBayar = () => (DOKU.DOKU_BASE_URL.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION');
app.get('/', (req, res) => res.json({ ok: true, payment: 'doku', mode: modeBayar() }));

// Konfigurasi publik. Rahasia API tidak pernah dikirim ke browser.
app.get('/api/config', (req, res) => res.json({ paymentProvider: 'doku', mode: modeBayar(), shippingProvider: 'biteship', shippingMode: !BITESHIP_API_KEY ? 'NOT_CONFIGURED' : BITESHIP_API_KEY.startsWith('biteship_live.') ? 'LIVE' : BITESHIP_API_KEY.startsWith('biteship_test.') ? 'SANDBOX' : 'INVALID_KEY' }));

// --- Cek ongkir (Biteship). Kode pos asal selalu dari server, klien tidak bisa menentukannya ---
app.post('/api/ongkir', limit(30, 60000), handle(async (req, res) => {
  const b = req.body || {}, i = (Array.isArray(b.items) ? b.items : [])[0] || {};
  if (!i.weight && !b.berat) return bad(res, 'Berat paket wajib diisi.');
  try {
    res.json(await biteship.cekTarif({
      tujuan: str(b.destination_postal_code, 5), kurir: str(b.couriers, 100),
      beratGram: Number(i.weight) * (Number(i.quantity) || 1) || Number(b.berat) * 1000, nilai: i.value
    }));
  } catch (e) { console.error('ongkir:', e.message); bad(res, 'Ongkir belum bisa dicek saat ini.', 502); }
}));

// --- Lacak resi (Biteship) ---
app.get('/api/lacak', limit(30, 60000), handle(async (req, res) => {
  try { res.json(await biteship.lacak(str(req.query.resi, 40), str(req.query.kurir, 20))); }
  catch (e) { console.error('lacak:', e.message); bad(res, 'Resi tidak ditemukan atau layanan sedang sibuk.', 502); }
}));

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

// Satu fungsi untuk pratinjau (/api/hitung) dan pembuatan pesanan (/api/bayar), jadi angkanya selalu sama.
async function hitungPesanan(b) {
  const d = P.hitungDasar(b, { minSubtotal: +MIN_SUBTOTAL, maxSubtotal: +MAX_SUBTOTAL });
  const kodepos = str(b.kodepos, 5);
  let ongkir = 0, sumber = 'tidak_ada';
  if (!d.kurir.teknisi) {
    if (!/^\d{5}$/.test(kodepos)) throw new InputError('Masukkan kode pos tujuan 5 digit agar ongkir aktual dapat dihitung.');
    try { ongkir = await biteship.ongkirUntuk(d.kurirId, kodepos, d.berat, d.subtotal); }
    catch (e) { console.error('biteship checkout:', e.message); throw new InputError('Tarif aktual Biteship gagal diambil. Periksa kode pos tujuan dan API Key LIVE. Pesanan belum dapat dilanjutkan.'); }
    sumber = 'biteship';
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

  try {
    const pay = await DOKU.buatCheckout({
      invoice, total: h.total, nama, hp,
      callbackUrl: DOKU_CALLBACK_URL || 'https://smarthomebogor.my.id/?payment=return',
      notifyUrl: DOKU_NOTIFY_URL
    });
    order.doku_token = pay.token_id || null; save();
    return res.json({ invoice, total: h.total, ongkir: h.ongkir, fee: h.fee, payment_url: pay.url, provider: 'doku' });
  } catch (e) {
    console.error('doku bayar:', e.message);
    order.status = 'gagal_buat_pembayaran'; save();
    return bad(res, 'Gagal membuat pembayaran. Coba lagi atau hubungi kami lewat WhatsApp.', 502);
  }
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

// --- Webhook DOKU: verifikasi signature + cek nominal + idempotensi ---
app.post(DOKU_NOTIFY_PATH, (req, res) => {
  try {
    if (!DOKU.verifikasiNotifikasi(req.headers, req.rawBody, DOKU_NOTIFY_PATH)) return bad(res, 'Signature DOKU tidak valid.', 401);
    const body = req.body || {};
    const invoice = str(body.order && body.order.invoice_number, 64);
    const o = orders[invoice];
    if (!o) return res.status(200).json({ ok: true, ignored: true });
    const dibayar = Number(body.order && body.order.amount);
    if (!Number.isFinite(dibayar) || dibayar !== Number(o.total)) { console.error('DOKU nominal tidak cocok', invoice, dibayar, o.total); return bad(res, 'Nominal callback tidak cocok.', 400); }
    const status = String(body.transaction && body.transaction.status || '').toUpperCase();
    const SUDAH = ['lunas', 'dijadwalkan', 'dikirim', 'selesai', 'dibatalkan'];
    // Di DOKU Checkout, pembeli boleh ganti metode setelah gagal, jadi hanya SUCCESS yang mengubah status.
    if (status === 'SUCCESS' && !SUDAH.includes(o.status)) {
      o.status = 'lunas'; o.diperbarui = new Date().toISOString(); save();
      console.log('DOKU STATUS', invoice, 'lunas');
      notify('PEMBAYARAN LUNAS\n' + ringkasOrder(o));
    }
    return res.status(200).json({ ok: true });
  } catch (e) { console.error('doku webhook:', e.message); return bad(res, 'Webhook error.', 500); }
});

app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: 'Terjadi kesalahan.' }); });
app.listen(PORT, () => console.log('Backend SHB jalan di port ' + PORT + ' | ' + 'DOKU | ' + modeBayar()));
