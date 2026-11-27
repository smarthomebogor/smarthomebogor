// Backend Smart Home Bogor: iPaymu Checkout + Biteship LIVE
// Deploy ke Railway/Render. Jangan di GitHub Pages. Lihat README.md untuk langkahnya.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const P = require('./pricing');
const IPAYMU = require('./ipaymu');
const { createBiteship } = require('./biteship');
const IPAYMU_NOTIFY_PATH = '/api/webhook-ipaymu';


const {
  BITESHIP_API_KEY,
  ALLOWED_ORIGINS, DATA_DIR, ORIGIN_POSTAL_CODE = '16100', ADMIN_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  MIN_SUBTOTAL = '100000', MAX_SUBTOTAL = '200000000', COMPONENT_DEFAULT_WEIGHT_GRAM = '1000', PORT = 3000
} = process.env;

const biteship = createBiteship({ apiKey: BITESHIP_API_KEY, originPostalCode: ORIGIN_POSTAL_CODE, requireLive: true });

for (const k of ['IPAYMU_VA', 'IPAYMU_API_KEY', 'BITESHIP_API_KEY']) {
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

const modeBayar = () => IPAYMU.mode();
app.get('/', (req, res) => res.json({ ok: true, payment: 'ipaymu', mode: modeBayar() }));

// Konfigurasi publik. Rahasia API tidak pernah dikirim ke browser.
app.get('/api/config', (req, res) => res.json({ paymentProvider: 'ipaymu', paymentReady: !!(process.env.IPAYMU_VA && process.env.IPAYMU_API_KEY), mode: modeBayar(), shippingProvider: 'biteship', shippingMode: !BITESHIP_API_KEY ? 'NOT_CONFIGURED' : BITESHIP_API_KEY.startsWith('biteship_live.') ? 'LIVE' : BITESHIP_API_KEY.startsWith('biteship_test.') ? 'SANDBOX' : 'INVALID_KEY' }));

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
const KOMPONEN = {
  1: { nama: 'ESP32 DevKit (32 pin)', harga: 85000 },
  2: { nama: 'ESP32-CAM + programmer', harga: 115000 },
  3: { nama: 'NodeMCU ESP8266 V3', harga: 55000 },
  4: { nama: 'Raspberry Pi Pico 2 W', harga: 110000 },
  5: { nama: 'Modul Relay 4 Channel 5V', harga: 38000 },
  6: { nama: 'Solenoid Door Lock 12V', harga: 75000 },
  7: { nama: 'Motor Servo MG996R', harga: 60000 },
  8: { nama: 'Sensor Suhu dan Kelembapan DHT22', harga: 55000 },
  9: { nama: 'Sensor Gerak PIR HC-SR501', harga: 18000 },
  10: { nama: 'Sensor Gas MQ-2', harga: 25000 },
  11: { nama: 'Sensor Magnetik Pintu MC-38', harga: 15000 },
  12: { nama: 'Raspberry Pi Zero 2 W (gateway)', harga: 350000 }
};
function rapikanKomponen(src) {
  const items = {};
  for (const [id, q0] of Object.entries(src && typeof src === 'object' ? src : {})) {
    if (!KOMPONEN[id]) continue;
    const q = Math.min(50, Math.max(0, parseInt(q0, 10) || 0));
    if (q) items[id] = q;
  }
  if (!Object.keys(items).length) throw new InputError('Pilih minimal satu komponen.');
  return items;
}
function totalKomponen(items) {
  return Object.entries(items).reduce((sum, [id, qty]) => sum + KOMPONEN[id].harga * qty, 0);
}
function ringkasOrder(o) {
  const map = o.type === 'komponen' ? KOMPONEN : P.NAMA;
  const brg = Object.keys(o.items || {}).map(k => `${map[k] ? (map[k].nama || map[k]) : k} x${o.items[k]}`).join(', ');
  const detail = o.type === 'paket'
    ? 'Paket Smart Home | Pemasangan teknisi termasuk harga | Pembayaran setelah pemasangan dan uji coba'
    : `Pembelian komponen | Pengiriman: ${o.courier_name || o.kurir || '-'} ${o.service_name || ''}`;
  return `${o.invoice}\n${o.nama} | ${o.hp}\n${o.alamat} (${o.kodepos || o.kota || ''})\n${brg}\n${detail}\nTotal: ${rp(o.total)}`;
}

// --- Checkout paket: ajukan pemasangan, bayar setelah teknisi selesai ---
function hitungHargaPaket(itemsSrc) {
  const items = P.hitungDasar({ items: itemsSrc, install: 'included', kurir: 'jne-reg', pay: 'qris', kota: 'bogor', berat: 1 }, { minSubtotal: +MIN_SUBTOTAL, maxSubtotal: +MAX_SUBTOTAL }).items;
  const nilaiBarang = Object.entries(items).reduce((sum, [k, q]) => sum + P.HARGA[k] * q, 0);
  return { items, nilaiBarang, subtotal: nilaiBarang + P.TEKNISI_FEE };
}
app.post('/api/paket/hitung', limit(60, 60000), handle(async (req, res) => {
  const h = hitungHargaPaket(req.body && req.body.items);
  res.json({ items: h.items, subtotal: h.subtotal, jasa_teknisi: 0, pemasangan_termasuk: true, total_tagihan_setelah_pemasangan: h.subtotal });
}));
app.post('/api/paket/pesan', limit(10, 60000), handle(async (req, res) => {
  const b = req.body || {};
  const nama = str(b.nama, 60), hp = str(b.hp, 20).replace(/[^\d+]/g, ''), alamat = str(b.alamat, 300);
  if (!nama || hp.length < 8 || !alamat) return bad(res, 'Nama, WhatsApp, dan alamat pemasangan wajib diisi.');
  const h = hitungHargaPaket(b.items);
  const invoice = 'SHB-PKT-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
  const order = { type: 'paket', invoice, nama, hp, alamat, kota: str(b.kota, 60), kodepos: str(b.kodepos, 5), items: h.items,
    subtotal: h.subtotal, total: h.subtotal, jasa_teknisi: 0, pemasangan_termasuk: true,
    status: 'menunggu_pemasangan', payment_mode: 'setelah_pemasangan_dan_uji_coba', catatan: str(b.catatan, 500),
    preferensi_jadwal: str(b.preferensi_jadwal, 80), dibuat: new Date().toISOString() };
  orders[invoice] = order; save();
  await notify('PERMINTAAN PAKET SMART HOME BARU\n' + ringkasOrder(order) + `\nCatatan: ${order.catatan || '-'}\nPreferensi jadwal: ${order.preferensi_jadwal || '-'}`);
  res.json({ success: true, invoice, status: order.status, total: order.total, payment_mode: order.payment_mode,
    message: 'Permintaan pemasangan diterima. Tim akan menghubungi untuk konfirmasi jadwal. Pembayaran dilakukan setelah pemasangan dan uji coba selesai.' });
}));

// --- Cek tarif pengiriman komponen via Biteship LIVE ---
app.post('/api/komponen/ongkir', limit(30, 60000), handle(async (req, res) => {
  const b = req.body || {}, items = rapikanKomponen(b.items), kodepos = str(b.kodepos, 5);
  if (!/^\d{5}$/.test(kodepos)) return bad(res, 'Masukkan kode pos tujuan 5 digit.');
  const weight = Math.min(100000, Math.max(100, Number(COMPONENT_DEFAULT_WEIGHT_GRAM) || 1000));
  const subtotal = totalKomponen(items);
  const rates = await biteship.cekTarif({ tujuan: kodepos, kurir: ['jne', 'jnt', 'sicepat', 'anteraja'], beratGram: weight, nilai: subtotal, nama: 'Komponen Smart Home Bogor' });
  res.json({ success: true, subtotal, weight_gram: weight, pricing: rates.pricing });
}));

// --- Pesanan komponen: ongkir LIVE + pembayaran di awal melalui iPaymu ---
app.post('/api/komponen/bayar', limit(10, 60000), handle(async (req, res) => {
  const b = req.body || {};
  const nama = str(b.nama, 60), hp = str(b.hp, 20).replace(/[^\d+]/g, ''), alamat = str(b.alamat, 300), kodepos = str(b.kodepos, 5);
  if (!nama || hp.length < 8 || !alamat) return bad(res, 'Nama, WhatsApp, dan alamat pengiriman wajib diisi.');
  if (!/^\d{5}$/.test(kodepos)) return bad(res, 'Kode pos tujuan harus 5 digit.');
  const items = rapikanKomponen(b.items), subtotal = totalKomponen(items);
  const weight = Math.min(100000, Math.max(100, Number(COMPONENT_DEFAULT_WEIGHT_GRAM) || 1000));
  const courierCode = str(b.courier_code, 20).toLowerCase(), serviceCode = str(b.service_code, 30).toLowerCase();
  if (!['jne', 'jnt', 'sicepat', 'anteraja'].includes(courierCode)) return bad(res, 'Kurir tidak valid.');
  const rates = await biteship.cekTarif({ tujuan: kodepos, kurir: [courierCode], beratGram: weight, nilai: subtotal, nama: 'Komponen Smart Home Bogor' });
  const rate = rates.pricing.find(x => x.courier_code === courierCode && x.service_code === serviceCode);
  if (!rate) return bad(res, 'Layanan kurir yang dipilih sudah tidak tersedia. Silakan cek ongkir kembali.');
  const total = subtotal + rate.price;
  const invoice = 'SHB-KMP-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
  const order = { type: 'komponen', invoice, nama, hp, alamat, kodepos, items, subtotal, ongkir: rate.price, ongkir_sumber: 'biteship_live',
    courier_code: rate.courier_code, courier_name: rate.courier_name, service_code: rate.service_code, service_name: rate.service_name,
    duration: rate.duration, berat_gram: weight, total, fee: 0, status: 'menunggu_bayar', payment_mode: 'bayar_di_awal', dibuat: new Date().toISOString() };
  orders[invoice] = order; save();
  try {
    const products = Object.entries(items).map(([id, qty]) => ({ name: KOMPONEN[id].nama, qty, price: KOMPONEN[id].harga, description: 'Komponen Smart Home Bogor' }));
    products.push({ name: 'Ongkos kirim ' + rate.courier_name + ' ' + rate.service_name, qty: 1, price: rate.price, description: 'Tarif pengiriman aktual Biteship' });
    const pay = await IPAYMU.buatCheckout({ invoice, total, nama, hp, products });
    order.ipaymu_session_id = pay.session_id; order.payment_provider = 'ipaymu'; save();
    await notify('PESANAN KOMPONEN MENUNGGU PEMBAYARAN\n' + ringkasOrder(order));
    return res.json({ success: true, invoice, subtotal, ongkir: rate.price, total, courier_name: rate.courier_name,
      service_name: rate.service_name, duration: rate.duration, payment_url: pay.url, provider: 'ipaymu' });
  } catch (e) {
    console.error('ipaymu komponen:', e.message); order.status = 'gagal_buat_pembayaran'; save();
    return bad(res, 'Gagal membuat pembayaran iPaymu. Periksa konfigurasi sandbox di Railway.', 502);
  }
}));

// Endpoint lama dinonaktifkan agar paket tidak tertagih di awal.
app.post('/api/hitung', (req, res) => res.status(410).json({ error: 'Gunakan /api/paket/hitung untuk paket atau /api/komponen/ongkir untuk komponen.' }));
app.post('/api/bayar', (req, res) => res.status(410).json({ error: 'Paket dibayar setelah pemasangan. Gunakan /api/paket/pesan atau /api/komponen/bayar.' }));

// Cek status pesanan (invoice acak, jadi tidak mudah ditebak). Data pribadi tidak dikembalikan.
app.get('/api/status/:invoice', limit(30, 60000), (req, res) => {
  const o = orders[str(req.params.invoice, 40)];
  if (!o) return bad(res, 'Pesanan tidak ditemukan.', 404);
  res.json({ invoice: o.invoice, status: o.status, total: o.total, resi: o.resi || null });
});

// --- Admin sederhana (aktif hanya jika ADMIN_TOKEN diisi). Pakai header: Authorization: Bearer <ADMIN_TOKEN> ---
const STATUS_ADMIN = ['menunggu_bayar', 'menunggu_pemasangan', 'menunggu_pembayaran_setelah_instalasi', 'lunas', 'cod_menunggu_jadwal', 'dijadwalkan', 'dikirim', 'selesai', 'dibatalkan'];
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

// Buat tautan iPaymu untuk paket hanya setelah teknisi menyelesaikan pemasangan dan uji coba.
app.post('/api/admin/orders/:invoice/payment', limit(10, 60000), adminOnly, handle(async (req, res) => {
  const o = orders[str(req.params.invoice, 40)];
  if (!o) return bad(res, 'Pesanan tidak ditemukan.', 404);
  if (o.type !== 'paket' || o.status !== 'menunggu_pembayaran_setelah_instalasi') {
    return bad(res, 'Tautan pembayaran paket hanya dapat dibuat setelah status diubah menjadi menunggu_pembayaran_setelah_instalasi.');
  }
  const products = Object.entries(o.items || {}).map(([id, qty]) => ({ name: P.NAMA[id] || ('Perangkat ' + id), qty, price: P.HARGA[id], description: 'Perangkat dalam paket Smart Home' }));
  products.push({ name: 'Jasa pemasangan dan uji coba (termasuk paket)', qty: 1, price: P.TEKNISI_FEE, description: 'Jasa pemasangan sudah termasuk dalam harga paket' });
  const pay = await IPAYMU.buatCheckout({ invoice: o.invoice, total: o.total, nama: o.nama, hp: o.hp, products });
  o.ipaymu_session_id = pay.session_id; o.payment_provider = 'ipaymu'; o.payment_url_created = new Date().toISOString(); save();
  await notify('TAUTAN PEMBAYARAN PAKET DIBUAT\n' + ringkasOrder(o));
  res.json({ success: true, invoice: o.invoice, payment_url: pay.url, total: o.total, provider: 'ipaymu' });
}));

// --- Webhook iPaymu: validasi X-Signature, nominal, referensi, dan idempotensi ---
app.post(IPAYMU_NOTIFY_PATH, (req, res) => {
  try {
    const body = req.body || {};
    if (!IPAYMU.verifyCallback(req.headers, body)) {
      console.warn('iPaymu callback diabaikan: signature tidak valid.');
      return res.status(200).json({ status: 'ignored', reason: 'invalid_signature' });
    }
    const invoice = str(body.reference_id || body.referenceId, 64);
    const o = orders[invoice];
    if (!o || !['komponen', 'paket'].includes(o.type)) return res.status(200).json({ status: 'ignored', reason: 'order_not_found' });
    const amount = Number(body.amount != null ? body.amount : body.total);
    if (!Number.isFinite(amount) || amount !== Number(o.total)) {
      console.error('iPaymu nominal callback tidak cocok', invoice, amount, o.total);
      return res.status(200).json({ status: 'ignored', reason: 'amount_mismatch' });
    }
    const statusCode = Number(body.status_code);
    const statusText = String(body.status || '').toLowerCase();
    if ((statusCode === 1 || statusText === 'berhasil') && o.status !== 'lunas') {
      o.status = 'lunas'; o.ipaymu_trx_id = String(body.trx_id || '');
      o.payment_channel = String(body.channel || body.via || '');
      o.dibayar = body.paid_at || new Date().toISOString();
      o.diperbarui = new Date().toISOString(); save();
      notify((o.type === 'paket' ? 'PEMBAYARAN PAKET LUNAS\n' : 'PEMBAYARAN KOMPONEN LUNAS\n') + ringkasOrder(o) + `\nChannel: ${o.payment_channel || '-'}`);
      console.log('iPaymu STATUS', invoice, 'lunas');
    }
    return res.status(200).json({ status: 'success', message: 'OK' });
  } catch (e) {
    console.error('ipaymu webhook:', e.message);
    return res.status(200).json({ status: 'error_received' });
  }
});

app.use((err, req, res, next) => { console.error(err.message); res.status(err.status || 500).json({ error: 'Terjadi kesalahan.' }); });
app.listen(PORT, () => console.log('Backend SHB jalan di port ' + PORT + ' | iPaymu ' + modeBayar() + ' | Biteship ' + (!BITESHIP_API_KEY ? 'NOT_CONFIGURED' : BITESHIP_API_KEY.startsWith('biteship_live.') ? 'LIVE' : 'NON_LIVE')));
