'use strict';
// Semua urusan Biteship ada di file ini: cek tarif, ongkir untuk checkout, dan lacak resi.
// Hanya memakai fetch standar, jadi bisa jalan di Node 18+ (Railway) dan Cloudflare Workers.
//
// Cara pakai:
//   const biteship = require('./biteship').createBiteship({ apiKey: process.env.BITESHIP_API_KEY, originPostalCode: '16100' });
//   await biteship.ongkirUntuk('jne-reg', '16680', 3, 1500000);   // angka rupiah atau null
//   await biteship.cekTarif({ tujuan: '16680', kurir: ['jne', 'jnt'], beratGram: 2000, nilai: 500000 });
//   await biteship.lacak('JNE123456', 'jne');

const API = 'https://api.biteship.com/v1';

// Kode kurir yang boleh diminta dari klien.
const KURIR_BOLEH = ['jne', 'jnt', 'sicepat', 'anteraja', 'tiki', 'pos', 'ninja', 'lion', 'idexpress'];

// ID kurir di pricing.js -> [kode kurir Biteship, kode layanan (null = layanan termurah)]
const PETA_KURIR = {
  'jne-reg': ['jne', 'reg'],
  jnt: ['jnt', null],
  sicepat: ['sicepat', 'best'],
  anteraja: ['anteraja', 'reg']
};

const bersih = (v, max = 80) => String(v == null ? '' : v).replace(/[<>&"']/g, '').trim().slice(0, max);
const kodepos = v => /^\d{5}$/.test(String(v || ''));

function createBiteship({ apiKey, originPostalCode = '16100', timeoutMs = 10000, cacheMs = 5 * 60 * 1000, fetchImpl, requireLive = false } = {}) {
  const doFetch = fetchImpl || fetch;
  const cache = new Map();

  async function panggil(path, init = {}) {
    if (!apiKey) throw new Error('BITESHIP_API_KEY belum diisi di Railway.');
    if (requireLive && !String(apiKey).startsWith('biteship_live.')) throw new Error('Biteship belum menggunakan API Key LIVE. Pasang token biteship_live di Railway.');
    const r = await doFetch(API + path, {
      ...init,
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      // Log ringkas di server saja. Pesan asli Biteship tidak dikirim ke pembeli.
      console.error('biteship', path, r.status, JSON.stringify(j).slice(0, 300));
      throw new Error('Biteship menolak permintaan (' + r.status + ').');
    }
    return j;
  }

  // Tarif semua layanan dari kurir yang diminta. Hasil sudah dirapikan dan aman ditampilkan ke pembeli.
  async function cekTarif({ tujuan, kurir, beratGram = 1000, nilai = 0, nama = 'Paket Smart Home' }) {
    if (!kodepos(originPostalCode) || !kodepos(tujuan)) throw new Error('Kode pos tidak valid.');
    const kode = [...new Set((Array.isArray(kurir) ? kurir : String(kurir || '').split(','))
      .map(s => String(s).trim().toLowerCase()).filter(c => KURIR_BOLEH.includes(c)))];
    if (!kode.length) throw new Error('Kurir tidak valid.');
    const berat = Math.min(100000, Math.max(100, Math.round(Number(beratGram)) || 1000));
    const harga = Math.max(0, Math.round(Number(nilai)) || 0);

    const key = [tujuan, kode.join(','), berat, harga].join('|');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < cacheMs) return hit.v;

    const j = await panggil('/rates/couriers', {
      method: 'POST',
      body: JSON.stringify({
        origin_postal_code: originPostalCode, destination_postal_code: tujuan, couriers: kode.join(','),
        items: [{ name: bersih(nama), value: harga, weight: berat, quantity: 1 }]
      })
    });
    const pricing = (j.pricing || [])
      .map(p => ({
        courier_code: bersih(p.courier_code, 20).toLowerCase(),
        courier_name: bersih(p.courier_name),
        service_code: bersih(p.courier_service_code, 30).toLowerCase(),
        service_name: bersih(p.courier_service_name),
        duration: bersih(p.duration, 40),
        price: Number(p.price)
      }))
      .filter(p => p.courier_code && Number.isFinite(p.price) && p.price > 0)
      .sort((a, b) => a.price - b.price);

    const hasil = { success: true, pricing };
    cache.set(key, { t: Date.now(), v: hasil });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return hasil;
  }

  // Tarif checkout wajib berasal dari respons Biteship. Tidak ada fallback estimasi.
  async function ongkirUntuk(kurirId, tujuan, beratKg, nilai) {
    if (kurirId === 'teknisi') return null;
    const m = PETA_KURIR[kurirId];
    if (!m) throw new Error('Pilihan kurir tidak didukung Biteship.');
    if (!kodepos(tujuan)) throw new Error('Masukkan kode pos tujuan 5 digit untuk menghitung ongkir aktual.');
    const { pricing } = await cekTarif({ tujuan, kurir: [m[0]], beratGram: Math.round(beratKg * 1000), nilai });
    const cocok = pricing.filter(p => p.courier_code === m[0] && (!m[1] || p.service_code === m[1]));
    if (!cocok.length) throw new Error('Tarif kurir tidak tersedia untuk alamat tujuan tersebut.');
    return Math.min(...cocok.map(p => p.price));
  }

  // Lacak resi. Hanya field yang dipakai frontend yang dikembalikan.
  async function lacak(resi, kurir) {
    const kode = String(kurir || '').toLowerCase();
    if (!/^[A-Za-z0-9-]{5,40}$/.test(String(resi || '')) || !KURIR_BOLEH.includes(kode)) throw new Error('Resi atau kurir tidak valid.');
    const j = await panggil(`/trackings/${encodeURIComponent(resi)}/couriers/${kode}`);
    return {
      success: true,
      status: bersih(j.status, 40),
      history: (Array.isArray(j.history) ? j.history : []).slice(0, 50).map(h => ({
        status: bersih(h.status, 40), note: bersih(h.note, 200), updated_at: bersih(h.updated_at, 40)
      }))
    };
  }

  return { cekTarif, ongkirUntuk, lacak };
}

module.exports = { createBiteship, KURIR_BOLEH, PETA_KURIR };
