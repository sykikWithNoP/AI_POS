// Sales: authoritative billing, invoice numbering per fiscal year, lifecycle pending -> paid | void.
import { db, tx, nowIso } from '../db.js';
import { badRequest, notFound, conflict, randomToken, HttpError } from '../lib.js';
import { emit, notify } from '../bus.js';
import { calculateBill, toMinor, formatMoney } from '../../shared/billing.js';
import { getGroup, nextSequence } from './settings.js';
import { bsDate, fiscalYear, fyTag } from '../nepali.js';
import { adjustStock, priceWithOptions } from './items.js';
import { getCustomer, redemptionValue, adjustPoints, pointsFor, recordVisit } from './customers.js';
import { currentShiftId } from './shifts.js';
import { getPlan, activePlan, activate } from './memberships.js';
import { append as appendLedger, saleSnapshot } from '../security/ledger.js';

const MAX_LINES = 500;

function parseDiscount(d) {
  if (!d || !d.value) return undefined;
  const type = d.type === 'percent' ? 'percent' : 'amount';
  const value = type === 'percent' ? Math.min(100, Math.max(0, Number(d.value) || 0)) : toMinor(d.value);
  return { type, value };
}

/** Build bill lines from client input, always pricing catalog items from the DB. */
function buildLines(inputLines) {
  if (!Array.isArray(inputLines) || inputLines.length === 0) throw badRequest('Cart is empty');
  if (inputLines.length > MAX_LINES) throw badRequest('Too many lines');
  const getItem = db.prepare('SELECT * FROM items WHERE id = ?');
  return inputLines.map((l) => {
    if (l.membershipPlanId) {
      const plan = getPlan(l.membershipPlanId);
      if (!plan.active) throw badRequest(`Plan ${plan.name} is not available`);
      return { itemId: null, membershipPlanId: plan.id, name: `Membership: ${plan.name}${plan.duration_days ? ` (${plan.duration_days} days)` : ' (lifetime)'}`, qty: 1, unitPrice: plan.fee, taxRate: null };
    }
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest('Quantity must be positive');

    if (l.itemId) {
      const row = getItem.get(Number(l.itemId));
      if (!row) throw badRequest(`Item ${l.itemId} no longer exists`);
      const item = { ...row, options: row.options ? JSON.parse(row.options) : [] };
      const priced = priceWithOptions(item, l.options);
      return { itemId: item.id, name: priced.name, qty, unitPrice: priced.unitPrice, unitCost: item.cost || 0, taxRate: item.tax_rate, discount: parseDiscount(l.discount) };
    }
    // Open/custom line (e.g. "Misc"), priced by the cashier.
    const name = String(l.name || '').trim();
    if (!name) throw badRequest('Custom line needs a name');
    return { itemId: null, name: name.slice(0, 120), qty, unitPrice: toMinor(l.unitPrice), taxRate: l.taxRate ?? null, discount: parseDiscount(l.discount) };
  });
}

/**
 * Rule: manual + extension discounts above the limit (Settings → Checkout) need the owner PIN.
 * Member pricing and redeemed points are rule-based, so they don't count toward the limit.
 */
function enforceDiscountLimit(bill, { elevated } = {}) {
  const max = Number(getGroup('checkout').maxDiscountPercent);
  const manual = bill.discount - (bill.member?.amount || 0) - (bill.redeem?.amount || 0);
  if (elevated || !(max >= 0) || bill.subtotal <= 0) return;
  if (manual > Math.round((bill.subtotal * max) / 100)) {
    throw new HttpError(403, `Discounts above ${max}% need the owner PIN`, 'pin_required');
  }
}

export function quote(input) {
  const tax = getGroup('tax');
  const lines = buildLines(input.lines);
  if (lines.some((l) => l.membershipPlanId) && !input.customerId) throw badRequest('Pick the customer the membership is for');
  const redeem = redemptionValue(input.customerId, input.redeemPoints);
  const opts = {
    taxRate: tax.rate, taxInclusive: tax.inclusive, serviceChargeRate: tax.serviceChargeRate,
    cartDiscount: parseDiscount(input.cartDiscount),
    extraDiscounts: [...(input.extraDiscounts || []).map((d) => toMinor(d.amount)), redeem.amount],
  };
  // Member pricing: plan discount on the goods (not on the membership fee itself), after other discounts.
  const plan = input.customerId ? activePlan(getCustomer(input.customerId)) : null;
  let member = null;
  if (plan && plan.discount_percent > 0) {
    const pre = calculateBill(lines, opts);
    const base = pre.lines.filter((l) => !l.membershipPlanId).reduce((a, l) => a + l.net - l.cartDiscountShare, 0);
    const amount = Math.round((base * plan.discount_percent) / 100);
    if (amount > 0) { member = { plan: plan.name, percent: plan.discount_percent, amount }; opts.extraDiscounts.push(amount); }
  }
  const bill = calculateBill(lines, opts);
  return { ...bill, redeem, member };
}

export function createSale(input, ctx = {}) {
  const bill = quote(input);
  enforceDiscountLimit(bill, ctx);
  const biz = getGroup('business');
  const ird = getGroup('ird');
  if (getGroup('shifts').required && !currentShiftId()) throw badRequest('Open a shift before selling');
  const customerId = input.customerId ? getCustomer(input.customerId).id : null;
  const known = customerId ? getCustomer(customerId) : {};
  const c = { name: known.name, pan: known.pan, phone: known.phone, email: known.email, ...Object.fromEntries(Object.entries(input.customer || {}).filter(([, v]) => v)) };
  const pan = c.pan ? String(c.pan).trim() : null;
  if (pan && !/^\d{9}$/.test(pan)) throw badRequest('PAN/VAT number must be 9 digits');

  const sale = tx(() => {
    const now = new Date();
    const fy = fiscalYear(now);
    const n = nextSequence(fy);
    const invoiceNo = `${biz.invoicePrefix || 'INV'}-${fyTag(fy)}-${String(n).padStart(5, '0')}`;
    const r = db.prepare(`INSERT INTO sales (invoice_no, fiscal_year, bs_date, status, customer_name, customer_pan, customer_phone, customer_email,
        subtotal, discount, service_charge, taxable, exempt, tax, total, notes, public_token, ird_status, created_at, customer_id, shift_id, points_redeemed, member_discount)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      invoiceNo, fy, bsDate(now), str(c.name), pan, str(c.phone), str(c.email),
      bill.subtotal, bill.discount, bill.serviceCharge, bill.taxable, bill.exempt, bill.tax, bill.total,
      str(input.notes, 500), randomToken(18), ird.enabled ? 'pending' : 'off', now.toISOString(), customerId, currentShiftId(), bill.redeem.points, bill.member?.amount || 0);
    const saleId = Number(r.lastInsertRowid);
    if (bill.redeem.points) adjustPoints(customerId, -bill.redeem.points);
    const ins = db.prepare('INSERT INTO sale_items (sale_id, item_id, name, qty, unit_price, discount, tax_rate, tax, total, membership_plan_id, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const l of bill.lines) ins.run(saleId, l.itemId, l.name, l.qty, l.unitPrice, l.lineDiscount + l.cartDiscountShare, l.taxRate, l.tax, l.total, l.membershipPlanId || null, l.unitCost ?? null);
    // Sign the issued bill: from here its numbers and lines are frozen.
    appendLedger('sale.issued', saleId, saleSnapshot(saleId));
    return getSale(saleId);
  });
  emit('sale.created', { sale });
  return sale;
}

const str = (v, max = 120) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

export function getSale(id) {
  const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id));
  if (!s) throw notFound('Sale');
  return hydrate(s);
}

export function getSaleByToken(token) {
  const s = db.prepare('SELECT * FROM sales WHERE public_token = ?').get(String(token));
  if (!s) throw notFound('Bill');
  return hydrate(s);
}

export function findSaleByInvoice(invoiceNo) {
  const s = db.prepare('SELECT * FROM sales WHERE invoice_no = ?').get(String(invoiceNo));
  return s ? hydrate(s) : null;
}

function hydrate(s) {
  s.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(s.id);
  s.payments = db.prepare('SELECT id, method, amount, tendered, status, reference, pay_url, created_at, verified_at FROM payments WHERE sale_id = ? ORDER BY id').all(s.id);
  s.ird_response = s.ird_response ? JSON.parse(s.ird_response) : null;
  s.refunds = db.prepare('SELECT id, amount, method, reason, credit_note, ird_status, created_at FROM refunds WHERE sale_id = ? ORDER BY id').all(s.id);
  s.due = s.status === 'pending' ? Math.max(0, s.total - s.paid) : 0;
  return s;
}

export function listSales({ from, to, status, q, limit = 200, offset = 0, due } = {}) {
  const where = [], args = [];
  if (due === '1') where.push("status = 'pending' AND postponed = 1");
  if (from) { where.push('created_at >= ?'); args.push(from); }
  if (to) { where.push('created_at < ?'); args.push(to); }
  if (status) { where.push('status = ?'); args.push(status); }
  if (q) { where.push('(invoice_no LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR customer_pan = ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, q); }
  const lim = Math.min(1000, Math.max(1, Number(limit) || 200));
  const sql = `SELECT * FROM sales ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...args, lim, Math.max(0, Number(offset) || 0));
}

/**
 * Called by the payments service whenever a payment becomes verified.
 * Recomputes paid amount; flips the sale to paid exactly once.
 */
export function settleSale(saleId) {
  const result = tx(() => {
    const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!s) throw notFound('Sale');
    const { paid } = db.prepare("SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE sale_id = ? AND status = 'verified'").get(saleId);
    const { change } = db.prepare("SELECT COALESCE(SUM(MAX(COALESCE(tendered, amount) - amount, 0)), 0) AS change FROM payments WHERE sale_id = ? AND status = 'verified'").get(saleId);
    const methods = db.prepare("SELECT DISTINCT method FROM payments WHERE sale_id = ? AND status = 'verified'").all(saleId).map((r) => r.method);
    const becamePaid = s.status === 'pending' && paid >= s.total;
    db.prepare(`UPDATE sales SET paid = ?, change_due = ?, payment_method = ?, status = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ?`)
      .run(paid, change, methods.join('+') || null, becamePaid ? 'paid' : s.status, becamePaid ? nowIso() : null, saleId);
    if (becamePaid) {
      appendLedger('sale.paid', saleId, { paid, methods });
      // Postponed bills already took stock out when they were issued.
      if (!s.postponed) for (const it of db.prepare('SELECT item_id, qty FROM sale_items WHERE sale_id = ? AND item_id IS NOT NULL').all(saleId)) adjustStock(it.item_id, -it.qty, { kind: 'sale', ref: s.invoice_no });
      if (s.customer_id) {
        for (const m of db.prepare('SELECT membership_plan_id FROM sale_items WHERE sale_id = ? AND membership_plan_id IS NOT NULL').all(saleId)) activate(s.customer_id, m.membership_plan_id);
        const earned = pointsFor(s.total, s.customer_id);
        adjustPoints(s.customer_id, earned);
        recordVisit(s.customer_id, s.total);
        db.prepare('UPDATE sales SET points_earned = ? WHERE id = ?').run(earned, saleId);
      }
    }
    return { becamePaid };
  });
  const sale = getSale(saleId);
  if (result.becamePaid) {
    const sym = getGroup('business').currencySymbol;
    notify({ type: 'sale.paid', level: 'success', title: `Paid ${formatMoney(sale.total, sym)}`, body: `${sale.invoice_no} via ${sale.payment_method}`, data: { saleId } });
    emit('sale.paid', { sale });
  } else {
    emit('sale.updated', { sale });
  }
  return sale;
}

export function voidSale(id, reason) {
  const s = getSale(id);
  if (s.status === 'void') throw conflict('Sale already void');
  if (s.refunded > 0) throw conflict('This bill has refunds; refund the remaining items instead of voiding');
  if (!reason || !String(reason).trim()) throw badRequest('A reason is required to void a bill');
  tx(() => {
    db.prepare("UPDATE sales SET status = 'void', void_reason = ? WHERE id = ?").run(String(reason).slice(0, 200), s.id);
    appendLedger('sale.void', s.id, { reason: String(reason).slice(0, 200), wasPaid: s.status === 'paid' });
    db.prepare("UPDATE payments SET status = 'cancelled' WHERE sale_id = ? AND status = 'pending'").run(s.id);
    if (s.status === 'paid' || s.postponed) for (const it of s.items) if (it.item_id) adjustStock(it.item_id, it.qty - it.refunded_qty, { kind: 'void', ref: s.invoice_no, reason: String(reason).slice(0, 120) });
    // Give back redeemed points; take back points earned on this bill.
    if (s.customer_id) adjustPoints(s.customer_id, s.points_redeemed - (s.status === 'paid' ? s.points_earned : 0));
  });
  const sale = getSale(id);
  emit('sale.void', { sale, wasPaid: s.status === 'paid', wasSynced: s.ird_status === 'synced' });
  return sale;
}

export function setIrdState(id, status, response) {
  db.prepare('UPDATE sales SET ird_status = ?, ird_response = ? WHERE id = ?').run(status, JSON.stringify(response ?? null), id);
  const sale = getSale(id);
  emit('sale.updated', { sale });
  return sale;
}

/**
 * Pay later: issue the bill now (goods leave, invoice stands, IRD gets it), collect payment afterwards.
 * Enabled in Settings → Checkout.
 */
export function postponeSale(id, { dueDate } = {}) {
  const cfg = getGroup('checkout');
  if (!cfg.allowPostpone) throw badRequest('Pay later is turned off in Settings → Checkout');
  const s = getSale(id);
  if (s.status !== 'pending') throw conflict(`Sale is already ${s.status}`);
  if (s.postponed) return s;
  if (cfg.postponeRequiresCustomer && !s.customer_id) throw badRequest('Pick a saved customer to let them pay later');
  let due = dueDate ? new Date(dueDate) : new Date(Date.now() + Math.max(0, cfg.defaultDueDays) * 86400_000);
  if (Number.isNaN(due.getTime())) throw badRequest('Invalid due date');
  tx(() => {
    db.prepare('UPDATE sales SET postponed = 1, due_date = ? WHERE id = ?').run(due.toISOString(), s.id);
    appendLedger('sale.postponed', s.id, { due: due.toISOString() });
    for (const it of s.items) if (it.item_id) adjustStock(it.item_id, -it.qty, { kind: 'sale', ref: s.invoice_no, reason: 'pay later' });
  });
  const sale = getSale(id);
  const sym = getGroup('business').currencySymbol;
  notify({ type: 'sale.postponed', level: 'info', title: `Pay later: ${formatMoney(sale.total - sale.paid, sym)}`, body: `${sale.invoice_no} · ${sale.customer_name || 'customer'} · due ${due.toISOString().slice(0, 10)}`, data: { saleId: sale.id } });
  emit('sale.postponed', { sale });
  return sale;
}

export function outstanding({ customerId } = {}) {
  const where = customerId ? 'AND customer_id = ?' : '';
  return db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total - paid), 0) AS amount,
      COALESCE(SUM(CASE WHEN due_date < ? THEN total - paid ELSE 0 END), 0) AS overdue
    FROM sales WHERE status = 'pending' AND postponed = 1 ${where}`).get(new Date().toISOString(), ...(customerId ? [customerId] : []));
}
