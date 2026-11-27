'use strict';
// Logika harga di SERVER. Klien hanya boleh mengirim pilihan (jumlah perangkat, mode pasang, kota, kurir).
// Kalau harga perangkat di frontend (DEVICES di smartHomeData) berubah, ubah juga HARGA di sini.

const HARGA = { lampu: 275000, plug: 225000, sensor: 350000, lock: 1250000, cctv: 1750000, speaker: 450000 };
const NAMA = { lampu: 'Lampu Smart WiFi', plug: 'Smart Plug', sensor: 'Sensor Gerak', lock: 'Smart Lock', cctv: 'CCTV + Doorbell', speaker: 'Speaker Voice' };
const MAX_QTY = 20;

const ZONA = { bogor: 1, 'kab-bogor': 1, depok: 1.5, jakarta: 1.5, bekasi: 1.5, tangerang: 1.5, bandung: 2.2, luar: 2.5 };
// Daftar zona tujuan yang tersedia pada checkout.
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
  qris: { nama: 'iPaymu', fee: () => 0 }
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
  const nilaiBarang = Object.keys(items).reduce((a, k) => a + items[k] * HARGA[k], 0);
  if (!nilaiBarang) throw new InputError('Pilih minimal satu perangkat di konfigurator.');
  // Harga paket sudah mencakup jasa pemasangan. Biaya pemasangan tidak ditagihkan lagi.
  const subtotal = nilaiBarang + TEKNISI_FEE;
  if (subtotal < minSubtotal || subtotal > maxSubtotal) throw new InputError('Subtotal tidak valid.');

  const kurir = KURIR[b.kurir], pay = PAY[b.pay], zona = ZONA[b.kota];
  if (!kurir || kurir.teknisi || !pay || !zona) throw new InputError('Kurir, pembayaran, atau kota tidak valid.');
  const berat = Math.min(100, Math.max(1, Number(b.berat) || 1));

  return {
    items, nilaiBarang, subtotal, install: 'included', berat, kota: b.kota,
    kurirId: b.kurir, kurir, payId: b.pay, pay,
    jasaTeknisi: 0,
    ongkirEstimasi: ongkirEstimasi(b.kurir, b.kota, berat)
  };
}

function opsiKurir(kota, berat) {
  return Object.keys(KURIR).filter(id => !KURIR[id].teknisi)
    .map(id => ({ id, nama: KURIR[id].nama, ongkir: ongkirEstimasi(id, kota, berat) }));
}

module.exports = { HARGA, NAMA, ZONA, ZONA_TEKNISI, KURIR, PAY, TEKNISI_FEE, InputError, hitungDasar, opsiKurir, ongkirEstimasi };
