// eSewa ePay v2. Docs: https://developer.esewa.com.np/pages/Epay
import crypto from 'node:crypto';
import { httpJson, safeEqual } from '../lib.js';
import { toMajor } from '../../shared/billing.js';

const URLS = {
  sandbox: { form: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form', status: 'https://rc.esewa.com.np/api/epay/transaction/status/' },
  live: { form: 'https://epay.esewa.com.np/api/epay/main/v2/form', status: 'https://esewa.com.np/api/epay/transaction/status/' },
};
// Public sandbox credentials published by eSewa for testing.
export const SANDBOX_SECRET = '8gBm/:&EnhH.1/q';

export function sign(secret, fields, names) {
  const message = names.split(',').map((n) => `${n}=${fields[n]}`).join(',');
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

const secretOf = (cfg) => cfg.secretKey || (cfg.sandbox ? SANDBOX_SECRET : '');

export function initiate(cfg, { payment, sale, baseUrl }) {
  const env = cfg.sandbox ? URLS.sandbox : URLS.live;
  const uuid = `${sale.invoice_no}-${payment.id}`.replace(/[^A-Za-z0-9-]/g, '-');
  const amount = toMajor(payment.amount).toFixed(2);
  const fields = {
    amount, tax_amount: '0', product_service_charge: '0', product_delivery_charge: '0', total_amount: amount,
    transaction_uuid: uuid, product_code: cfg.productCode,
    success_url: `${baseUrl}/pay/esewa/return?pid=${payment.id}`,
    failure_url: `${baseUrl}/pay/esewa/return?pid=${payment.id}&failed=1`,
    signed_field_names: 'total_amount,transaction_uuid,product_code',
  };
  fields.signature = sign(secretOf(cfg), fields, fields.signed_field_names);
  return { providerRef: uuid, form: { action: env.form, fields } };
}

/** Verify the base64 `data` payload eSewa appends to success_url. */
export function decodeReturn(cfg, data) {
  const json = JSON.parse(Buffer.from(String(data), 'base64').toString('utf8'));
  const expected = sign(secretOf(cfg), json, json.signed_field_names);
  return { valid: safeEqual(expected, json.signature || ''), json };
}

export async function verify(cfg, payment) {
  const env = cfg.sandbox ? URLS.sandbox : URLS.live;
  const qs = new URLSearchParams({ product_code: cfg.productCode, total_amount: toMajor(payment.amount).toFixed(2), transaction_uuid: payment.provider_ref });
  const r = await httpJson(`${env.status}?${qs}`);
  const status = r.json?.status;
  if (status === 'COMPLETE') return { status: 'verified', reference: r.json.ref_id, detail: r.json };
  if (['CANCELED', 'NOT_FOUND', 'FULL_REFUND', 'PARTIAL_REFUND'].includes(status) && payment.ageMs > 10 * 60_000) return { status: 'failed', detail: r.json };
  return { status: 'pending', detail: r.json ?? { http: r.status } };
}
