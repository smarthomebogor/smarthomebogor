'use strict';
// DOKU Checkout (non-SNAP, hosted page). Dokumentasi: https://developers.doku.com (Accept Payments > DOKU Checkout)
const crypto = require('crypto');

const {
  DOKU_CLIENT_ID, DOKU_SECRET_KEY,
  DOKU_BASE_URL = 'https://api-sandbox.doku.com' // produksi: https://api.doku.com
} = process.env;

const CHECKOUT_PATH = '/checkout/v1/payment';

const sha256b64 = s => crypto.createHash('sha256').update(s, 'utf8').digest('base64');

// Komponen signature dipisah dengan karakter newline (\n) murni, urutan tidak boleh berubah.
function buatSignature({ clientId, requestId, timestamp, target, digest }) {
  let comp = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${target}`;
  if (digest) comp += `\nDigest:${digest}`;
  return 'HMACSHA256=' + crypto.createHmac('sha256', DOKU_SECRET_KEY).update(comp).digest('base64');
}

// Buat halaman checkout. Mengembalikan { url, token_id, expired_date }
async function buatCheckout({ invoice, total, nama, hp, callbackUrl, notifyUrl, dueMinutes = 60 }) {
  if (!DOKU_CLIENT_ID || !DOKU_SECRET_KEY) throw new Error('DOKU_CLIENT_ID / DOKU_SECRET_KEY belum diisi.');
  const body = JSON.stringify({
    order: { amount: Number(total), invoice_number: invoice, callback_url: callbackUrl },
    payment: { payment_due_date: dueMinutes },
    customer: { name: nama, phone: hp },
    additional_info: notifyUrl ? { override_notification_url: notifyUrl } : undefined
  });
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); // yyyy-MM-ddTHH:mm:ssZ (UTC)
  const signature = buatSignature({
    clientId: DOKU_CLIENT_ID, requestId, timestamp, target: CHECKOUT_PATH, digest: sha256b64(body)
  });
  const r = await fetch(DOKU_BASE_URL + CHECKOUT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Id': DOKU_CLIENT_ID, 'Request-Id': requestId, 'Request-Timestamp': timestamp, Signature: signature },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.response || !j.response.payment || !j.response.payment.url) {
    console.error('DOKU create checkout gagal:', r.status, JSON.stringify(j).slice(0, 500));
    throw new Error('DOKU menolak pembuatan pembayaran.');
  }
  return j.response.payment;
}

// Verifikasi notifikasi dari DOKU. rawBody HARUS string mentah persis seperti yang diterima (bukan hasil JSON.stringify ulang).
function verifikasiNotifikasi(headers, rawBody, target) {
  const clientId = headers['client-id'], requestId = headers['request-id'], timestamp = headers['request-timestamp'], got = headers['signature'];
  if (!clientId || !requestId || !timestamp || !got || typeof rawBody !== 'string') return false;
  if (clientId !== DOKU_CLIENT_ID) return false;
  const expected = buatSignature({ clientId, requestId, timestamp, target, digest: sha256b64(rawBody) });
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { buatCheckout, verifikasiNotifikasi, buatSignature, sha256b64, DOKU_BASE_URL };
