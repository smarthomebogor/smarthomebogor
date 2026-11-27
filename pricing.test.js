const assert = require('assert');
const p = require('./pricing');
// Harga paket Starter sudah mencakup jasa pemasangan.
let d = p.hitungDasar({ items: { lampu: 4, plug: 1, sensor: 1 }, install: 'included', kurir: 'jne-reg', pay: 'qris', kota: 'bogor', berat: 5 });
assert.strictEqual(d.nilaiBarang, 1675000);
assert.strictEqual(d.subtotal, 3175000);
assert.strictEqual(d.jasaTeknisi, 0);
assert.strictEqual(d.install, 'included');
// Harga paket Family dan Premium tetap sama dengan harga paket di situs.
const paket = { starter: [{ lampu: 4, plug: 1, sensor: 1 }, 3175000], family: [{ lampu: 6, lock: 1, cctv: 1, speaker: 1 }, 6600000], premium: [{ lampu: 8, plug: 2, sensor: 2, lock: 1, cctv: 2, speaker: 1 }, 10050000] };
for (const [n, [items, harga]] of Object.entries(paket)) {
  const b = p.hitungDasar({ items, install: 'included', kurir: 'jne-reg', pay: 'qris', kota: 'bogor', berat: 5 });
  assert.strictEqual(b.subtotal, harga, 'paket ' + n);
  assert.strictEqual(b.jasaTeknisi, 0);
}
// Semua opsi kurir tersedia; tidak ada opsi teknisi atau COD.
const opsi = p.opsiKurir('bogor', 5);
assert.deepStrictEqual(opsi.map(x => x.id), ['jne-reg', 'jnt', 'sicepat', 'anteraja']);
assert.deepStrictEqual(Object.keys(p.PAY), ['qris']);
assert.throws(() => p.hitungDasar({ items: {}, kurir: 'jne-reg', pay: 'qris', kota: 'bogor' }), p.InputError);
console.log('pricing OK');
