'use strict';
const crypto = require('crypto');

const {
  IPAYMU_VA,
  IPAYMU_API_KEY,
  IPAYMU_BASE_URL = 'https://sandbox.ipaymu.com/api/v2',
  IPAYMU_CALLBACK_URL = 'https://smarthomebogor-production.up.railway.app/api/webhook-ipaymu',
  IPAYMU_RETURN_URL = 'https://smarthomebogor.my.id/?payment=return',
  IPAYMU_CANCEL_URL = 'https://smarthomebogor.my.id/?payment=cancel'
} = process.env;

function timestamp14(date = new Date()) {
  return date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}
function requestSignature(method, va, bodyJson, apiKey) {
  const bodyHash = crypto.createHash('sha256').update(bodyJson, 'utf8').digest('hex').toLowerCase();
  const stringToSign = `${String(method).toUpperCase()}:${va}:${bodyHash}:${apiKey}`;
  return crypto.createHmac('sha256', apiKey).update(stringToSign, 'utf8').digest('hex');
}
async function buatCheckout({ invoice, total, nama, hp, products }) {
  if (!IPAYMU_VA || !IPAYMU_API_KEY) throw new Error('IPAYMU_VA dan IPAYMU_API_KEY belum diisi di Railway.');
  const lines = Array.isArray(products) && products.length ? products : [{ name: 'Komponen Smart Home Bogor', qty: 1, price: Number(total), description: 'Pembelian komponen Smart Home Bogor' }];
  const computed = lines.reduce((sum, x) => sum + Number(x.qty) * Number(x.price), 0);
  if (computed !== Number(total)) throw new Error('Rincian produk iPaymu tidak sama dengan total pesanan.');
  const body = {
    product: lines.map(x => String(x.name).slice(0, 120)),
    qty: lines.map(x => String(x.qty)),
    price: lines.map(x => String(x.price)),
    description: lines.map(x => String(x.description || x.name).slice(0, 200)),
    returnUrl: IPAYMU_RETURN_URL,
    notifyUrl: IPAYMU_CALLBACK_URL,
    cancelUrl: IPAYMU_CANCEL_URL,
    referenceId: String(invoice),
    buyerName: String(nama).slice(0, 80),
    buyerPhone: String(hp).slice(0, 30),
    expired: 24
  };
  const bodyJson = JSON.stringify(body);
  const timestamp = timestamp14();
  const signature = requestSignature('POST', IPAYMU_VA, bodyJson, IPAYMU_API_KEY);
  const base = String(IPAYMU_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(base + '/payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      va: IPAYMU_VA,
      signature,
      timestamp
    },
    body: bodyJson,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  const url = data && data.Data && data.Data.Url;
  if (!response.ok || Number(data.Status) !== 200 || !url) {
    console.error('iPaymu create payment gagal:', response.status, JSON.stringify(data).slice(0, 500));
    throw new Error('iPaymu menolak pembuatan pembayaran.');
  }
  return { url, session_id: data.Data.SessionID || null, raw: data };
}

function normalizeCallback(raw) {
  const out = {};
  for (const key of Object.keys(raw || {})) {
    let value = raw[key];
    if (key === 'signature') continue;
    if (key === 'is_escrow') out[key] = value === true || value === 'true' || value === '1' || value === 1;
    else if (['trx_id', 'status_code', 'transaction_status_code', 'paid_off'].includes(key)) out[key] = parseInt(value, 10);
    else if (key === 'additional_info') {
      if (value === '[]' || value == null || value === '') out[key] = [];
      else if (typeof value === 'string') { try { out[key] = JSON.parse(value); } catch (_) { out[key] = value; } }
      else out[key] = value;
    } else if (Array.isArray(value)) out[key] = value.map(String);
    else if (value === null) out[key] = 'null';
    else if (typeof value === 'object') out[key] = value;
    else out[key] = String(value);
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'additional_info')) out.additional_info = [];
  return out;
}
function verifyCallback(headers, raw) {
  if (!IPAYMU_VA) return false;
  const received = String(headers['x-signature'] || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  const normalized = normalizeCallback(raw);
  const sorted = {};
  Object.keys(normalized).sort((a, b) => a.localeCompare(b)).forEach(k => { sorted[k] = normalized[k]; });
  const jsonBody = JSON.stringify(sorted).replace(/\//g, '\\/');
  const calculated = crypto.createHmac('sha256', IPAYMU_VA).update(jsonBody, 'utf8').digest('hex');
  const a = Buffer.from(received, 'hex'), b = Buffer.from(calculated, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function mode() {
  return String(IPAYMU_BASE_URL).includes('sandbox') ? 'SANDBOX' : 'PRODUCTION';
}
module.exports = { buatCheckout, requestSignature, verifyCallback, normalizeCallback, mode };
