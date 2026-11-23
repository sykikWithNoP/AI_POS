// Partial or full refunds (returns) on paid bills. Each refund is a credit note:
// stock goes back, loyalty points are reversed proportionally, and IRD gets a bill-return if the bill was synced.
import { db, tx } from '../db.js';
import { badRequest, conflict } from '../lib.js';
import { emit, notify } from '../bus.js';
import { formatMoney } from '../../shared/billing.js';
import { getGroup } from './settings.js';
import { getSale } from './sales.js';
import { adjustStock } from './items.js';
import { adjustPoints, pointsFor } from './customers.js';
import { currentShiftId } from './shifts.js';
import { append as appendLedger, refundSnapshot } from '../security/ledger.js';

export const REFUND_METHODS = ['cash', 'card', 'qr', 'esewa', 'khalti', 'stripe', 'store_credit'];

export function createRefund(saleId, { lines, method = 'cash', reason } = {}) {
  const sale = getSale(saleId);
  if (sale.status !== 'paid') throw conflict('Only paid bills can be refunded');
  if (!reason || !String(reason).trim()) throw badRequest('A reason is required');
  if (!REFUND_METHODS.includes(method)) throw badRequest('Unknown refund method');
  if (!Array.isArray(lines) || !lines.length) throw badRequest('Pick at least one item to refund');

  const byId = new Map(sale.items.map((i) => [i.id, i]));
  const picked = lines.map((l) => {
    const it = byId.get(Number(l.saleItemId));
    if (!it) throw badRequest('Item is not on this bill');
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest('Refund quantity must be positive');
    if (qty > it.qty - it.refunded_qty + 1e-9) throw badRequest(`Only ${it.qty - it.refunded_qty} of ${it.name} can be refunded`);
    const share = qty / it.qty;
    return { it, qty, amount: Math.round(it.total * share), tax: Math.round(it.tax * share) };
  });
  const amount = picked.reduce((a, p) => a + p.amount, 0);
  const taxAmt = picked.reduce((a, p) => a + p.tax, 0);
  if (amount <= 0) throw badRequest('Nothing to refund');
  if (amount > sale.total - sale.refunded) throw badRequest('Refund exceeds what was paid');

  const refundId = tx(() => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM refunds WHERE sale_id = ?').get(sale.id).n + 1;
    const r = db.prepare(`INSERT INTO refunds (sale_id, shift_id, amount, taxable, tax, method, reason, lines, credit_note, ird_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sale.id, currentShiftId(), amount, amount - taxAmt, taxAmt, method, String(reason).slice(0, 200),
      JSON.stringify(picked.map((p) => ({ saleItemId: p.it.id, name: p.it.name, qty: p.qty, amount: p.amount, tax: p.tax }))),
      `CN-${sale.invoice_no}-${n}`, sale.ird_status === 'synced' ? 'pending' : 'off');
    for (const p of picked) {
      db.prepare('UPDATE sale_items SET refunded_qty = refunded_qty + ? WHERE id = ?').run(p.qty, p.it.id);
      if (p.it.item_id) adjustStock(p.it.item_id, p.qty);
    }
    db.prepare('UPDATE sales SET refunded = refunded + ? WHERE id = ?').run(amount, sale.id);
    if (sale.customer_id) adjustPoints(sale.customer_id, -Math.min(sale.points_earned, pointsFor(amount, sale.customer_id)));
    appendLedger('refund', Number(r.lastInsertRowid), refundSnapshot(Number(r.lastInsertRowid)));
    return Number(r.lastInsertRowid);
  });

  const refund = getRefund(refundId);
  const sym = getGroup('business').currencySymbol;
  notify({ type: 'refund.created', level: 'warn', title: `Refund ${formatMoney(amount, sym)}`, body: `${sale.invoice_no} · ${method} · ${reason}`, data: { saleId: sale.id, refundId } });
  emit('refund.created', { refund, sale: getSale(sale.id) });
  return { refund, sale: getSale(sale.id) };
}

export function getRefund(id) {
  const r = db.prepare('SELECT * FROM refunds WHERE id = ?').get(Number(id));
  if (!r) return null;
  return { ...r, lines: JSON.parse(r.lines), ird_response: r.ird_response ? JSON.parse(r.ird_response) : null };
}

export function setRefundIrd(id, status, response) {
  db.prepare('UPDATE refunds SET ird_status = ?, ird_response = ? WHERE id = ?').run(status, JSON.stringify(response ?? null), id);
}
