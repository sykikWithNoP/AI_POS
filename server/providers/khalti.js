// Khalti ePayment (KPG-2). Docs: https://docs.khalti.com/khalti-epayment/
import { httpJson, badRequest, HttpError } from '../lib.js';

const base = (cfg) => (cfg.sandbox ? 'https://dev.khalti.com/api/v2' : 'https://khalti.com/api/v2');
const headers = (cfg) => ({ Authorization: `Key ${cfg.secretKey}`, 'Content-Type': 'application/json' });

export async function initiate(cfg, { payment, sale, baseUrl }) {
  if (!cfg.secretKey) throw badRequest('Khalti secret key is not configured');
  if (payment.amount < 1000) throw badRequest('Khalti requires at least Rs. 10');
  const body = {
    return_url: `${baseUrl}/pay/khalti/return?pid=${payment.id}`,
    website_url: baseUrl,
    amount: payment.amount, // paisa
    purchase_order_id: `${sale.invoice_no}-${payment.id}`,
    purchase_order_name: `Bill ${sale.invoice_no}`,
    ...(sale.customer_name ? { customer_info: { name: sale.customer_name, phone: sale.customer_phone || undefined, email: sale.customer_email || undefined } } : {}),
  };
  const r = await httpJson(`${base(cfg)}/epayment/initiate/`, { method: 'POST', headers: headers(cfg), body: JSON.stringify(body) });
  if (!r.ok || !r.json?.pidx) throw new HttpError(502, `Khalti initiate failed: ${r.json?.detail || r.text?.slice(0, 200) || r.status}`, 'provider_error');
  return { providerRef: r.json.pidx, payUrl: r.json.payment_url };
}

export async function verify(cfg, payment) {
  const r = await httpJson(`${base(cfg)}/epayment/lookup/`, { method: 'POST', headers: headers(cfg), body: JSON.stringify({ pidx: payment.provider_ref }) });
  const s = r.json?.status;
  if (s === 'Completed') {
    if (Number(r.json.total_amount) !== payment.amount) return { status: 'failed', detail: { ...r.json, reason: 'amount mismatch' } };
    return { status: 'verified', reference: r.json.transaction_id, detail: r.json };
  }
  if (['Expired', 'User canceled', 'Refunded', 'Partially Refunded'].includes(s)) return { status: 'failed', detail: r.json };
  return { status: 'pending', detail: r.json ?? { http: r.status } };
}
