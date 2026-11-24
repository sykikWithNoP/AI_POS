// Stock received from suppliers, counted adjustments, and the movement history.
import { db, tx } from '../db.js';
import { badRequest, notFound } from '../lib.js';
import { emit } from '../bus.js';
import { toMinor } from '../../shared/billing.js';
import { adjustStock, getItem } from './items.js';
import { append as appendLedger } from '../security/ledger.js';

export const ADJUST_REASONS = ['count', 'damaged', 'expired', 'lost', 'theft', 'own use', 'other'];

/** Goods received. lines: [{ itemId, qty, unitCost? (major), updateCost? }] */
export function stockIn({ supplier, ref, lines } = {}) {
  if (!Array.isArray(lines) || !lines.length) throw badRequest('Add at least one item');
  if (lines.length > 300) throw badRequest('Too many lines');
  const clean = lines.map((l) => {
    const item = getItem(l.itemId);
    if (item.stock === null) throw badRequest(`${item.name} does not track stock — set a stock number on the item first`);
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6) throw badRequest(`Quantity for ${item.name} must be positive`);
    const unitCost = l.unitCost === undefined || l.unitCost === '' ? null : toMinor(l.unitCost);
    if (unitCost !== null && unitCost < 0) throw badRequest('Cost cannot be negative');
    return { item, qty, unitCost, updateCost: !!l.updateCost };
  });
  const sup = String(supplier || '').trim().slice(0, 80) || null;
  const reference = String(ref || '').trim().slice(0, 60) || null;
  tx(() => {
    for (const l of clean) {
      adjustStock(l.item.id, l.qty, { kind: 'in', supplier: sup, ref: reference, unitCost: l.unitCost });
      if (l.updateCost && l.unitCost !== null) db.prepare('UPDATE items SET cost = ? WHERE id = ?').run(l.unitCost, l.item.id);
    }
    appendLedger('stock.in', reference || '', { supplier: sup, lines: clean.map((l) => ({ itemId: l.item.id, qty: l.qty, unitCost: l.unitCost })) });
  });
  emit('stock.changed', {});
  return { received: clean.length, totalCost: clean.reduce((a, l) => a + (l.unitCost || 0) * l.qty, 0) };
}

/** Set a counted quantity (newQty) or apply a delta, with a reason. */
export function adjust({ itemId, newQty, delta, reason, note } = {}) {
  const item = getItem(itemId);
  if (item.stock === null) throw badRequest('This item does not track stock');
  if (!ADJUST_REASONS.includes(reason)) throw badRequest('Pick a reason');
  let d;
  if (newQty !== undefined && newQty !== '') { const n = Number(newQty); if (!Number.isFinite(n)) throw badRequest('Counted quantity must be a number'); d = n - item.stock; }
  else d = Number(delta);
  if (!Number.isFinite(d) || d === 0) throw badRequest('No change to record');
  const why = `${reason}${note ? `: ${String(note).slice(0, 100)}` : ''}`;
  tx(() => {
    adjustStock(item.id, d, { kind: 'adjust', reason: why });
    appendLedger('stock.adjust', item.id, { name: item.name, delta: d, reason: why });
  });
  emit('stock.changed', {});
  return getItem(item.id);
}

export function history({ itemId, kind, from, to, limit = 200 } = {}) {
  const where = [], args = [];
  if (itemId) { where.push('item_id = ?'); args.push(Number(itemId)); }
  if (kind) { where.push('kind = ?'); args.push(String(kind)); }
  if (from) { where.push('created_at >= ?'); args.push(from); }
  if (to) { where.push('created_at < ?'); args.push(to); }
  return db.prepare(`SELECT * FROM stock_movements ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(2000, Number(limit) || 200));
}
export { notFound };
