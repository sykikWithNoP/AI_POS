// Stripe Checkout via REST (BYOK). The webhook is optional; polling the session works on localhost.
import crypto from 'node:crypto';
import { httpJson, safeEqual, badRequest, HttpError } from '../lib.js';

const auth = (cfg) => ({ Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' });

export async function initiate(cfg, { payment, sale, baseUrl }) {
  if (!cfg.secretKey) throw badRequest('Stripe secret key is not configured');
  const unitAmount = Math.round(payment.amount * (Number(cfg.fxRate) || 1));
  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${baseUrl}/pay/stripe/return?pid=${payment.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/pay/stripe/return?pid=${payment.id}&cancelled=1`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': (cfg.currency || 'usd').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(unitAmount),
    'line_items[0][price_data][product_data][name]': `Bill ${sale.invoice_no}`,
    'metadata[payment_id]': String(payment.id),
    'metadata[invoice_no]': sale.invoice_no,
    client_reference_id: String(payment.id),
  });
  const r = await httpJson('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: auth(cfg), body: form.toString() });
  if (!r.ok) throw new HttpError(502, `Stripe error: ${r.json?.error?.message || r.status}`, 'provider_error');
  return { providerRef: r.json.id, payUrl: r.json.url };
}

export async function verify(cfg, payment) {
  const r = await httpJson(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(payment.provider_ref)}`, { headers: auth(cfg) });
  if (r.json?.payment_status === 'paid') return { status: 'verified', reference: r.json.payment_intent, detail: { id: r.json.id, amount_total: r.json.amount_total } };
  if (r.json?.status === 'expired') return { status: 'failed', detail: { status: 'expired' } };
  return { status: 'pending', detail: { status: r.json?.status, http: r.status } };
}

/** Verify a Stripe-Signature header (t=...,v1=...) against the raw body. */
export function verifyWebhook(secret, rawBody, header, toleranceSec = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return header.split(',').filter((p) => p.startsWith('v1=')).some((p) => safeEqual(p.slice(3), expected));
}
