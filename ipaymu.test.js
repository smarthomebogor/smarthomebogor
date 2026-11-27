const assert = require('assert');
const crypto = require('crypto');
process.env.IPAYMU_VA = '1234567890';
process.env.IPAYMU_API_KEY = 'test-api-key';
process.env.IPAYMU_BASE_URL = 'https://sandbox.ipaymu.com/api/v2';
const ipaymu = require('./ipaymu');

(async () => {
  const body = JSON.stringify({ product: ['Komponen'], qty: ['1'], price: ['100000'], description: ['Komponen'], returnUrl: 'https://example.com/return', notifyUrl: 'https://example.com/callback', cancelUrl: 'https://example.com/cancel', referenceId: 'INV-1' });
  const sig = ipaymu.requestSignature('POST', process.env.IPAYMU_VA, body, process.env.IPAYMU_API_KEY);
  assert.match(sig, /^[a-f0-9]{64}$/);

  const callback = { amount: '100000', reference_id: 'INV-1', status: 'berhasil', status_code: '1', trx_id: '12345', additional_info: '[]', is_escrow: '0' };
  const normalized = ipaymu.normalizeCallback(callback);
  const sorted = {};
  Object.keys(normalized).sort((a, b) => a.localeCompare(b)).forEach(k => { sorted[k] = normalized[k]; });
  const signatureBody = JSON.stringify(sorted).replace(/\//g, '\\/');
  const callbackSig = crypto.createHmac('sha256', process.env.IPAYMU_VA).update(signatureBody).digest('hex');
  assert.strictEqual(ipaymu.verifyCallback({ 'x-signature': callbackSig }, callback), true);
  assert.strictEqual(ipaymu.verifyCallback({ 'x-signature': '0'.repeat(64) }, callback), false);
  assert.strictEqual(normalized.status_code, 1);
  assert.strictEqual(normalized.trx_id, 12345);
  assert.strictEqual(normalized.is_escrow, false);
  assert.deepStrictEqual(normalized.additional_info, []);

  const originalFetch = global.fetch;
  let requested = null;
  global.fetch = async (url, options) => {
    requested = { url, options };
    return new Response(JSON.stringify({ Status: 200, Message: 'success', Data: { SessionID: 'session-1', Url: 'https://sandbox.ipaymu.com/payment/session-1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const pay = await ipaymu.buatCheckout({ invoice: 'INV-1', total: 110000, nama: 'Test Buyer', hp: '081234567890', products: [
      { name: 'ESP32', qty: 1, price: 100000 },
      { name: 'Ongkir JNE', qty: 1, price: 10000 }
    ] });
    assert.strictEqual(pay.url, 'https://sandbox.ipaymu.com/payment/session-1');
    assert.strictEqual(requested.url, 'https://sandbox.ipaymu.com/api/v2/payment');
    const sent = JSON.parse(requested.options.body);
    assert.strictEqual(sent.referenceId, 'INV-1');
    assert.deepStrictEqual(sent.price, ['100000', '10000']);
    assert.ok(requested.options.headers.signature);
    assert.ok(requested.options.headers.timestamp);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ipaymu OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
