const assert = require('assert');
const { createBiteship } = require('./biteship');

let panggilan = 0, terakhir = null;
const palsu = (status, body) => async (url, init) => { panggilan++; terakhir = { url, init }; return { ok: status < 400, status, json: async () => body }; };
const RATES = { success: true, pricing: [
  { courier_code: 'jne', courier_name: 'JNE', courier_service_code: 'yes', courier_service_name: 'Yakin Esok Sampai', duration: '1 day', price: 40000 },
  { courier_code: 'jne', courier_name: 'JNE', courier_service_code: 'reg', courier_service_name: 'Reguler', duration: '2 - 3 days', price: 18000 },
  { courier_code: 'jne', courier_name: 'JNE<script>', courier_service_code: 'oke', courier_service_name: 'OKE', duration: '3 days', price: 0 }
] };

(async () => {
  // Tarif: diurutkan, harga 0 dibuang, karakter HTML dibersihkan, origin dari server
  let b = createBiteship({ apiKey: 'KEY', originPostalCode: '16100', fetchImpl: palsu(200, RATES) });
  let r = await b.cekTarif({ tujuan: '16680', kurir: 'jne,xxx', beratGram: 2000, nilai: 500000 });
  assert.deepStrictEqual(r.pricing.map(p => p.service_code), ['reg', 'yes']);
  assert.strictEqual(JSON.parse(terakhir.init.body).origin_postal_code, '16100');
  assert.strictEqual(JSON.parse(terakhir.init.body).couriers, 'jne');
  assert.strictEqual(terakhir.init.headers.Authorization, 'KEY');

  // Cache: permintaan sama tidak memanggil Biteship lagi
  const n = panggilan; await b.cekTarif({ tujuan: '16680', kurir: 'jne', beratGram: 2000, nilai: 500000 });
  assert.strictEqual(panggilan, n);

  // Ongkir checkout: pilih layanan REG termurah, bukan YES
  assert.strictEqual(await b.ongkirUntuk('jne-reg', '16680', 2, 500000), 18000);
  // Teknisi tidak membutuhkan ekspedisi; kode pos invalid harus ditolak.
  assert.strictEqual(await b.ongkirUntuk('teknisi', '16680', 2, 1), null);
  await assert.rejects(() => b.ongkirUntuk('jne-reg', 'abc', 2, 1));

  // Biteship error harus menggagalkan checkout, bukan beralih ke estimasi zona.
  b = createBiteship({ apiKey: 'KEY', fetchImpl: palsu(401, { error: 'invalid key SECRET-DETAIL' }) });
  await assert.rejects(() => b.ongkirUntuk('jne-reg', '16680', 2, 1));
  await assert.rejects(() => b.cekTarif({ tujuan: '16680', kurir: 'jne' }), e => !/SECRET-DETAIL/.test(e.message));

  // Tanpa API key
  b = createBiteship({ apiKey: '', fetchImpl: palsu(200, RATES) });
  await assert.rejects(() => b.ongkirUntuk('jne-reg', '16680', 2, 1));

  // Lacak: hanya field yang dipakai frontend
  b = createBiteship({ apiKey: 'KEY', fetchImpl: palsu(200, { success: true, status: 'delivered', secret_field: 'x', history: [{ status: 'delivered', note: 'Diterima', updated_at: '2026-11-27T10:00:00+07:00', extra: 1 }] }) });
  const t = await b.lacak('JNE123456', 'jne');
  assert.deepStrictEqual(Object.keys(t), ['success', 'status', 'history']);
  assert.deepStrictEqual(Object.keys(t.history[0]), ['status', 'note', 'updated_at']);
  await assert.rejects(() => b.lacak('../x', 'jne'));
  await assert.rejects(() => b.lacak('JNE123456', 'bukan-kurir'));

  console.log('biteship OK');
})().catch(e => { console.error(e); process.exit(1); });
