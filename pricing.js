'use strict';
// Logika harga di SERVER. Klien hanya boleh mengirim pilihan (jumlah perangkat, mode pasang, kota, kurir).
// Kalau harga perangkat di frontend (DEVICES di smartHomeData) berubah, ubah juga HARGA di sini.

const HARGA = { lampu: 275000, plug: 225000, sensor: 350000, lock: 1250000, cctv: 1750000, speaker: 450000 };
const NAMA = { lampu: 'Lampu Smart WiFi', plug: 'Smart Plug', sensor: 'Sensor Gerak', lock: 'Smart Lock', cctv: 'CCTV + Doorbell', speaker: 'Speaker Voice' };
const MAX_QTY = 20;

const ZONA = { bogor: 1, 'kab-bogor': 1, depok: 1.5, jakarta: 1.5, bekasi: 1.5, tangerang: 1.5, bandung: 2.2, luar: 2.5 };
// Teknisi Datang hanya untuk Jabodetabek (sesuai klaim di situs). Area lain lewat WhatsApp.
const ZONA_TEKNISI = new Set(['bogor', 'kab-bogor', 'depok', 'jakarta', 'bekasi', 'tangerang']);

const KURIR = {
  'jne-reg': { nama: 'JNE REG', dasar: 12000 },
  jnt: { nama: 'J&T Express', dasar: 11000 },
  sicepat: { nama: 'SiCepat BEST', dasar: 13000 },
  anteraja: { nama: 'AnterAja Reguler', dasar: 10000 },
  teknisi: { nama: 'Teknisi Datang', dasar: 0, teknisi: true }
};
const TEKNISI_FEE = 1500000;

const PAY = {
  qris: { nama: 'iPaymu', fee: () => 0 },
  cod: { nama: 'COD (bayar ke teknisi)', fee: () => 0, cod: true }
};

class InputError extends Error {}

function rapikanItems(src) {
  const items = {};
  const s = src && typeof src === 'object' ? src : {};
  for (const k of Object.keys(HARGA)) {
    const q = Math.min(MAX_QTY, Math.max(0, parseInt(s[k], 10) || 0));
    if (q) items[k] = q;
  }
  return items;
}

function ongkirEstimasi(kurirId, kota, beratKg) {
  const k = KURIR[kurirId], z = ZONA[kota];
  if (!k || !z || k.teknisi) return 0;
  return Math.round(k.dasar * z * Math.max(1, beratKg / 2));
}

// Hitung bagian yang tidak butuh jaringan. Ongkir kurir bisa diganti tarif asli Biteship oleh server.
function hitungDasar(b, { minSubtotal = 100000, maxSubtotal = 200000000 } = {}) {
  b = b || {};
  const items = rapikanItems(b.items);
  const subtotal = Object.keys(items).reduce((a, k) => a + items[k] * HARGA[k], 0);
  if (!subtotal) throw new InputError('Pilih minimal satu perangkat di konfigurator.');
  if (subtotal < minSubtotal || subtotal > maxSubtotal) throw new InputError('Subtotal tidak valid.');

  const install = b.install === 'diy' ? 'diy' : 'technician';
  const kurir = KURIR[b.kurir], pay = PAY[b.pay], zona = ZONA[b.kota];
  if (!kurir || !pay || !zona) throw new InputError('Kurir, pembayaran, atau kota tidak valid.');
  const berat = Math.min(100, Math.max(1, Number(b.berat) || 1));

  if (install === 'technician' && !kurir.teknisi) throw new InputError('Pemasangan oleh teknisi memakai opsi Teknisi Datang.');
  if (install === 'diy' && kurir.teknisi) throw new InputError('Teknisi Datang hanya untuk pemasangan oleh teknisi. Pilih kurir pengiriman.');
  if (kurir.teknisi && !ZONA_TEKNISI.has(b.kota)) throw new InputError('Teknisi Datang hanya melayani Jabodetabek. Pilih Pasang Sendiri atau hubungi kami lewat WhatsApp.');
  if (pay.cod && !kurir.teknisi) throw new InputError('COD hanya untuk Teknisi Datang.');

  return {
    items, subtotal, install, berat, kota: b.kota,
    kurirId: b.kurir, kurir, payId: b.pay, pay,
    jasaTeknisi: install === 'technician' ? TEKNISI_FEE : 0,
    ongkirEstimasi: ongkirEstimasi(b.kurir, b.kota, berat)
  };
}

function opsiKurir(kota, berat, install) {
  return Object.keys(KURIR)
    .filter(id => (install === 'technician') === !!KURIR[id].teknisi)
    .map(id => ({ id, nama: KURIR[id].nama, ongkir: KURIR[id].teknisi ? 0 : ongkirEstimasi(id, kota, berat) }));
}

module.exports = { HARGA, NAMA, ZONA, ZONA_TEKNISI, KURIR, PAY, TEKNISI_FEE, InputError, hitungDasar, opsiKurir, ongkirEstimasi };
