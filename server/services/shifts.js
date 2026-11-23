// Shifts & cash drawer: open with a float, record pay-ins/outs, close with a count → variance + Z report.
import { db, tx, nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../lib.js';
import { emit, notify } from '../bus.js';
import { toMinor, formatMoney } from '../../shared/billing.js';
import { getGroup } from './settings.js';

export const currentShift = () => db.prepare("SELECT * FROM shifts WHERE status = 'open'").get() || null;
export const currentShiftId = () => currentShift()?.id ?? null;

export function openShift({ float, openedBy }) {
  const amount = toMinor(float ?? 0);
  if (amount < 0) throw badRequest('Float cannot be negative');
  try {
    const r = db.prepare("INSERT INTO shifts (status, opening_float, opened_by) VALUES ('open', ?, ?)").run(amount, String(openedBy || '').slice(0, 60) || null);
    const s = getShift(r.lastInsertRowid);
    emit('shift.opened', { shift: s });
    return s;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw conflict('A shift is already open');
    throw e;
  }
}

export function getShift(id) {
  const s = db.prepare('SELECT * FROM shifts WHERE id = ?').get(Number(id));
  if (!s) throw notFound('Shift');
  return { ...s, report: s.report ? JSON.parse(s.report) : null };
}

export function listShifts(limit = 30) {
  return db.prepare('SELECT id, status, opened_at, closed_at, opened_by, opening_float, expected_cash, counted_cash FROM shifts ORDER BY id DESC LIMIT ?').all(Math.min(200, Number(limit) || 30));
}

export function cashMovement({ kind, amount, reason }) {
  const s = currentShift();
  if (!s) throw badRequest('Open a shift first');
  if (!['in', 'out'].includes(kind)) throw badRequest('kind must be in or out');
  const a = toMinor(amount);
  if (a <= 0) throw badRequest('Amount must be positive');
  if (!reason || !String(reason).trim()) throw badRequest('Reason is required');
  db.prepare('INSERT INTO cash_movements (shift_id, kind, amount, reason) VALUES (?, ?, ?, ?)').run(s.id, kind, a, String(reason).slice(0, 120));
  return report(s.id);
}

/** X report (live) for a shift. */
export function report(shiftId) {
  const s = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  if (!s) throw notFound('Shift');
  const sales = db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS gross, COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(discount),0) AS discount
      FROM sales WHERE shift_id = ? AND status = 'paid'`).get(shiftId);
  const voids = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM sales WHERE shift_id = ? AND status = 'void'").get(shiftId);
  const methods = db.prepare(`SELECT method, COUNT(*) AS n, SUM(amount) AS amount FROM payments WHERE shift_id = ? AND status = 'verified' GROUP BY method ORDER BY amount DESC`).all(shiftId);
  const refunds = db.prepare('SELECT method, COUNT(*) AS n, SUM(amount) AS amount FROM refunds WHERE shift_id = ? GROUP BY method').all(shiftId);
  const moves = db.prepare('SELECT kind, amount, reason, created_at FROM cash_movements WHERE shift_id = ? ORDER BY id').all(shiftId);
  const cashSales = methods.find((m) => m.method === 'cash')?.amount || 0;
  const cashRefunds = refunds.find((r) => r.method === 'cash')?.amount || 0;
  const payIn = moves.filter((m) => m.kind === 'in').reduce((a, m) => a + m.amount, 0);
  const payOut = moves.filter((m) => m.kind === 'out').reduce((a, m) => a + m.amount, 0);
  const expected = s.opening_float + cashSales - cashRefunds + payIn - payOut;
  const refundTotal = refunds.reduce((a, r) => a + r.amount, 0);
  return {
    shiftId, status: s.status, openedAt: s.opened_at, closedAt: s.closed_at, openedBy: s.opened_by,
    float: s.opening_float, sales, net: sales.gross - refundTotal, voids, methods, refunds, refundTotal, movements: moves,
    cash: { float: s.opening_float, sales: cashSales, refunds: cashRefunds, payIn, payOut, expected },
    counted: s.counted_cash, variance: s.counted_cash === null ? null : s.counted_cash - expected,
  };
}

export function closeShift({ counted, note }) {
  const s = currentShift();
  if (!s) throw badRequest('No open shift');
  const c = toMinor(counted);
  if (c < 0 || counted === undefined || counted === '') throw badRequest('Enter the counted cash');
  const z = tx(() => {
    const pending = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE shift_id = ? AND status = 'pending'").get(s.id).n;
    const before = report(s.id);
    db.prepare("UPDATE shifts SET status = 'closed', closed_at = ?, counted_cash = ?, expected_cash = ?, note = ? WHERE id = ?")
      .run(nowIso(), c, before.cash.expected, String(note || '').slice(0, 300) || null, s.id);
    const z = { ...report(s.id), pendingPayments: pending };
    db.prepare('UPDATE shifts SET report = ? WHERE id = ?').run(JSON.stringify(z), s.id);
    return z;
  });
  const sym = getGroup('business').currencySymbol;
  notify({ type: 'shift.closed', level: z.variance === 0 ? 'success' : 'warn', title: `Shift closed · ${formatMoney(z.sales.gross, sym)}`, body: `Cash variance ${formatMoney(z.variance, sym)}`, data: { shiftId: s.id } });
  emit('shift.closed', { report: z });
  return z;
}
