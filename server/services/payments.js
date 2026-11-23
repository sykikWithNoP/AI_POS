// Payments: record, verify (instant, manual, provider-polled or webhook), then settle the sale.
import { db, nowIso } from '../db.js';
import { badRequest, notFound, conflict, log } from '../lib.js';
import { notify, emit } from '../bus.js';
import { toMinor, formatMoney } from '../../shared/billing.js';
import { getGroup } from './settings.js';
import { getSale, settleSale } from './sales.js';
import { currentShiftId } from './shifts.js';
import { append as appendLedger } from '../security/ledger.js';
import * as esewa from '../providers/esewa.js';
import * as khalti from '../providers/khalti.js';
import * as stripe from '../providers/stripe.js';

/** Payment methods. kind: instant (cash), manual (cashier confirms), online (provider verifies). */
export const METHODS = {
  cash: { kind: 'instant', label: 'Cash', enabled: () => true },
  card: { kind: 'manual', label: () => getGroup('card').label, enabled: () => getGroup('card').enabled },
  qr: { kind: 'manual', label: () => getGroup('qr').label, enabled: () => getGroup('qr').enabled },
  esewa: { kind: 'online', label: 'eSewa', enabled: () => getGroup('esewa').enabled, provider: esewa, cfg: () => getGroup('esewa') },
  khalti: { kind: 'online', label: 'Khalti', enabled: () => getGroup('khalti').enabled, provider: khalti, cfg: () => getGroup('khalti') },
  stripe: { kind: 'online', label: 'Stripe', enabled: () => getGroup('stripe').enabled, provider: stripe, cfg: () => getGroup('stripe') },
};

export function availableMethods() {
  return Object.entries(METHODS).filter(([, m]) => m.enabled()).map(([id, m]) => ({
    id, kind: m.kind, label: typeof m.label === 'function' ? m.label() : m.label,
    ...(id === 'qr' ? { payload: getGroup('qr').payload, imageUrl: getGroup('qr').imageUrl } : {}),
  }));
}

const getPaymentRow = (id) => db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(id));

export function getPayment(id) {
  const p = getPaymentRow(id);
  if (!p) throw notFound('Payment');
  return { ...p, detail: p.detail ? JSON.parse(p.detail) : null };
}

/**
 * Start a payment against a sale.
 * amount defaults to the amount due. For cash, `tendered` may exceed it (change is computed).
 */
export async function createPayment(saleId, input, { baseUrl }) {
  const sale = getSale(saleId);
  if (sale.status !== 'pending') throw conflict(`Sale is already ${sale.status}`);
  const method = METHODS[input.method];
  if (!method) throw badRequest('Unknown payment method');
  if (!method.enabled()) throw badRequest(`${input.method} is not enabled`);

  const due = sale.total - sale.paid;
  let amount = input.amount !== undefined && input.amount !== '' ? toMinor(input.amount) : due;
  let tendered = null;
  if (input.method === 'cash') {
    tendered = input.tendered !== undefined && input.tendered !== '' ? toMinor(input.tendered) : amount;
    if (tendered <= 0) throw badRequest('Tendered amount must be positive');
    amount = Math.min(due, tendered);
  }
  if (amount <= 0) throw badRequest('Nothing left to pay');
  if (amount > due) throw badRequest('Amount exceeds the amount due');

  const status = method.kind === 'instant' || (method.kind === 'manual' && input.confirm) ? 'verified' : 'pending';
  const r = db.prepare('INSERT INTO payments (sale_id, method, amount, tendered, status, reference, verified_at, shift_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sale.id, input.method, amount, tendered, status, str(input.reference), status === 'verified' ? nowIso() : null, currentShiftId());
  const paymentId = Number(r.lastInsertRowid);

  if (method.kind === 'online') {
    try {
      const init = await method.provider.initiate(method.cfg(), { payment: { id: paymentId, amount }, sale, baseUrl });
      db.prepare('UPDATE payments SET provider_ref = ?, pay_url = ? WHERE id = ?').run(init.providerRef, init.payUrl || null, paymentId);
      emit('payment.pending', { payment: getPayment(paymentId), saleId: sale.id });
      return { payment: getPayment(paymentId), form: init.form || null, sale: getSale(sale.id) };
    } catch (e) {
      db.prepare("UPDATE payments SET status = 'failed', detail = ? WHERE id = ?").run(JSON.stringify({ error: e.message }), paymentId);
      throw e;
    }
  }
  if (status === 'verified') onVerified(paymentId);
  return { payment: getPayment(paymentId), sale: getSale(sale.id) };
}

const str = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, 120));

function onVerified(paymentId) {
  const p = getPayment(paymentId);
  appendLedger('payment.verified', p.sale_id, { paymentId: p.id, method: p.method, amount: p.amount, reference: p.reference || null });
  const sym = getGroup('business').currencySymbol;
  emit('payment.verified', { payment: p });
  if (METHODS[p.method]?.kind !== 'instant') {
    notify({ type: 'payment.verified', level: 'success', title: `${METHODS[p.method]?.kind === 'online' ? 'Payment received' : 'Payment confirmed'}: ${formatMoney(p.amount, sym)}`, body: `${p.method}${p.reference ? ' · ref ' + p.reference : ''}`, data: { paymentId, saleId: p.sale_id } });
  }
  return settleSale(p.sale_id);
}

/** Mark a pending payment verified exactly once (idempotent). Returns true if this call changed it. */
export function markVerified(paymentId, { reference, detail } = {}) {
  const r = db.prepare("UPDATE payments SET status = 'verified', reference = COALESCE(?, reference), detail = ?, verified_at = ? WHERE id = ? AND status = 'pending'")
    .run(str(reference), detail ? JSON.stringify(detail) : null, nowIso(), Number(paymentId));
  if (r.changes === 1) { onVerified(paymentId); return true; }
  return false;
}

export function markFailed(paymentId, detail) {
  const r = db.prepare("UPDATE payments SET status = 'failed', detail = ? WHERE id = ? AND status = 'pending'").run(JSON.stringify(detail ?? null), Number(paymentId));
  if (r.changes === 1) {
    const p = getPayment(paymentId);
    notify({ type: 'payment.failed', level: 'error', title: `Payment failed (${p.method})`, body: detail?.reason || detail?.status || '', data: { paymentId, saleId: p.sale_id } });
    emit('payment.failed', { payment: p });
  }
}

/** Cashier confirms a manual payment (card/QR) after checking their terminal or bank app. */
export function confirmManual(paymentId, reference) {
  const p = getPayment(paymentId);
  if (METHODS[p.method]?.kind !== 'manual') throw badRequest('Only card/QR payments are confirmed manually');
  if (p.status !== 'pending') throw conflict(`Payment is ${p.status}`);
  markVerified(paymentId, { reference });
  return getPayment(paymentId);
}

export function cancelPayment(paymentId) {
  const r = db.prepare("UPDATE payments SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(Number(paymentId));
  if (!r.changes) throw conflict('Payment is not pending');
  const p = getPayment(paymentId);
  emit('payment.cancelled', { payment: p });
  return p;
}

/** Ask the provider for the true status of an online payment. */
export async function verifyWithProvider(paymentId) {
  const p = getPayment(paymentId);
  const m = METHODS[p.method];
  if (m?.kind !== 'online') throw badRequest('Not an online payment');
  if (p.status !== 'pending') return p;
  if (!p.provider_ref) throw badRequest('Payment was never initiated');
  const result = await m.provider.verify(m.cfg(), { ...p, ageMs: Date.now() - Date.parse(p.created_at) });
  if (result.status === 'verified') markVerified(p.id, result);
  else if (result.status === 'failed') markFailed(p.id, result.detail);
  return getPayment(paymentId);
}

/**
 * Generic signed webhook for any source (bank SMS forwarder, Fonepay merchant app, Zapier...).
 * Body: { payment_id? , invoice_no?, amount, reference, status }.
 */
export function handleGenericWebhook(body) {
  const amount = toMinor(body.amount);
  if (String(body.status || 'success').toLowerCase() !== 'success') return { ok: true, ignored: 'non-success status' };
  if (body.payment_id) {
    const p = getPayment(body.payment_id);
    if (p.amount !== amount) throw badRequest('Amount does not match the pending payment');
    return { ok: true, changed: markVerified(p.id, { reference: body.reference, detail: { via: 'webhook' } }) };
  }
  if (!body.invoice_no || !body.reference) throw badRequest('invoice_no and reference are required');
  const sale = db.prepare('SELECT id, total, paid, status FROM sales WHERE invoice_no = ?').get(String(body.invoice_no));
  if (!sale) throw notFound('Invoice');
  if (sale.status !== 'pending') return { ok: true, ignored: `sale is ${sale.status}` };
  if (amount <= 0 || amount > sale.total - sale.paid) throw badRequest('Amount does not match the amount due');
  // Dedupe on (method, provider_ref) so a retried webhook cannot double-pay.
  const exists = db.prepare("SELECT id FROM payments WHERE method = 'qr' AND provider_ref = ?").get(String(body.reference));
  if (exists) return { ok: true, duplicate: true };
  // Prefer verifying a pending QR payment the cashier already opened for this sale.
  const pendingQr = db.prepare("SELECT id FROM payments WHERE sale_id = ? AND method = 'qr' AND status = 'pending' AND amount = ? ORDER BY id DESC").get(sale.id, amount);
  if (pendingQr) {
    db.prepare('UPDATE payments SET provider_ref = ? WHERE id = ?').run(String(body.reference), pendingQr.id);
    return { ok: true, changed: markVerified(pendingQr.id, { reference: body.reference, detail: { via: 'webhook' } }) };
  }
  const r = db.prepare("INSERT INTO payments (sale_id, method, amount, status, reference, provider_ref, detail, shift_id) VALUES (?, 'qr', ?, 'pending', ?, ?, ?, ?)")
    .run(sale.id, amount, String(body.reference).slice(0, 120), String(body.reference), JSON.stringify({ via: 'webhook' }), currentShiftId());
  return { ok: true, changed: markVerified(Number(r.lastInsertRowid), { reference: body.reference }) };
}

// --- Background verifier: localhost can't receive provider webhooks, so we poll. ---
const lastCheck = new Map();
export async function pollPending() {
  const rows = db.prepare("SELECT id, method, created_at FROM payments WHERE status = 'pending' AND provider_ref IS NOT NULL AND method IN ('esewa','khalti','stripe')").all();
  for (const row of rows) {
    const age = Date.now() - Date.parse(row.created_at);
    if (age > 2 * 3600_000) { markFailed(row.id, { status: 'expired', reason: 'Not paid within 2 hours' }); continue; }
    const interval = age < 10 * 60_000 ? 5_000 : 30_000; // back off after 10 minutes
    if (Date.now() - (lastCheck.get(row.id) || 0) < interval) continue;
    lastCheck.set(row.id, Date.now());
    try { await verifyWithProvider(row.id); } catch (e) { log.warn('verify poll failed', { paymentId: row.id, err: e.message }); }
  }
}
