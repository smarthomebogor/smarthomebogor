const assert = require('assert');
const p = require('./pricing');
// Paket Starter + teknisi: 4 lampu + 1 plug + 1 sensor = 1.675.000, jasa 1.500.000
let d = p.hitungDasar({ items: { lampu: 4, plug: 1, sensor: 1 }, install: 'technician', kurir: 'teknisi', pay: 'cod', kota: 'bogor', berat: 5 });
assert.strictEqual(d.subtotal, 1675000); assert.strictEqual(d.jasaTeknisi, 1500000); assert.strictEqual(d.ongkirEstimasi, 0);
// Klien tidak bisa menentukan harga sendiri
d = p.hitungDasar({ items: { lampu: 4 }, subtotal: 1, install: 'diy', kurir: 'jnt', pay: 'qris', kota: 'depok', berat: 4 });
assert.strictEqual(d.subtotal, 1100000); assert.strictEqual(d.ongkirEstimasi, Math.round(11000 * 1.5 * 2));
// Aturan kombinasi
assert.throws(() => p.hitungDasar({ items: { lock: 1 }, install: 'technician', kurir: 'jnt', pay: 'qris', kota: 'bogor' }), p.InputError);
assert.throws(() => p.hitungDasar({ items: { lock: 1 }, install: 'diy', kurir: 'teknisi', pay: 'qris', kota: 'bogor' }), p.InputError);
assert.throws(() => p.hitungDasar({ items: { lock: 1 }, install: 'technician', kurir: 'teknisi', pay: 'qris', kota: 'bandung' }), p.InputError);
assert.throws(() => p.hitungDasar({ items: { lock: 1 }, install: 'diy', kurir: 'jnt', pay: 'cod', kota: 'bogor' }), p.InputError);
assert.throws(() => p.hitungDasar({ items: {}, install: 'diy', kurir: 'jnt', pay: 'qris', kota: 'bogor' }), p.InputError);
// Total paket di situs harus sama dengan jumlah satuan + teknisi
const paket = { starter: [{ lampu: 4, plug: 1, sensor: 1 }, 3175000], family: [{ lampu: 6, lock: 1, cctv: 1, speaker: 1 }, 6600000], premium: [{ lampu: 8, plug: 2, sensor: 2, lock: 1, cctv: 2, speaker: 1 }, 10050000] };
for (const [n, [items, harga]] of Object.entries(paket)) {
  const s = Object.keys(items).reduce((a, k) => a + items[k] * p.HARGA[k], 0) + p.TEKNISI_FEE;
  assert.strictEqual(s, harga, 'paket ' + n);
}
console.log('pricing OK');
