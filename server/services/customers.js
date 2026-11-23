// Customer directory and loyalty points.
import { db, nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../lib.js';
import { getGroup } from './settings.js';
import { toMinor } from '../../shared/billing.js';
import { activePlan, activate } from './memberships.js';

const str = (v, max = 120) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

function clean(input, partial) {
  const out = {};
  if ('name' in input || !partial) { out.name = str(input.name); if (!out.name) throw badRequest('Customer name is required'); }
  if ('phone' in input) out.phone = str(input.phone, 20);
  if ('email' in input) out.email = str(input.email);
  if ('pan' in input) { out.pan = str(input.pan, 9); if (out.pan && !/^\d{9}$/.test(out.pan)) throw badRequest('PAN must be 9 digits'); }
  if ('notes' in input) out.notes = str(input.notes, 500);
  return out;
}

export function listCustomers({ q, limit = 100 } = {}) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = q
    ? db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR pan = ? ORDER BY last_visit DESC NULLS LAST, name LIMIT ?').all(`%${q}%`, `%${q}%`, q, lim)
    : db.prepare('SELECT * FROM customers ORDER BY last_visit DESC NULLS LAST, name LIMIT ?').all(lim);
  return rows.map(withMembership);
}

/** Attach the current membership (or null) for display. */
export function withMembership(c) {
  if (!c) return c;
  const plan = activePlan(c);
  return { ...c, membership: plan ? { planId: plan.id, name: plan.name, color: plan.color, discountPercent: plan.discount_percent, pointsMultiplier: plan.points_multiplier, until: c.member_until } : null,
    membershipExpired: !!c.plan_id && !plan };
}

export function getCustomer(id) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(id));
  if (!c) throw notFound('Customer');
  const due = db.prepare("SELECT COALESCE(SUM(total - paid), 0) AS amount, COUNT(*) AS bills FROM sales WHERE customer_id = ? AND status = 'pending' AND postponed = 1").get(c.id);
  return { ...withMembership(c), outstanding: due.amount, outstandingBills: due.bills };
}

export function customerHistory(id) {
  getCustomer(id);
  return db.prepare('SELECT id, invoice_no, created_at, total, paid, status, postponed, due_date, points_earned, points_redeemed FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 50').all(Number(id));
}

const guard = (fn) => { try { return fn(); } catch (e) { if (String(e.message).includes('UNIQUE')) throw conflict('A customer with this phone already exists'); throw e; } };

export function createCustomer(input) {
  const d = clean(input, false);
  const cols = Object.keys(d);
  const r = guard(() => db.prepare(`INSERT INTO customers (${cols}) VALUES (${cols.map(() => '?')})`).run(...cols.map((c) => d[c])));
  // Default tier for new customers (Settings → Memberships).
  const def = Number(getGroup('memberships').defaultPlanId);
  if (def && db.prepare('SELECT 1 FROM membership_plans WHERE id = ? AND active = 1').get(def)) activate(Number(r.lastInsertRowid), def, { via: 'default' });
  return getCustomer(r.lastInsertRowid);
}

export function updateCustomer(id, input) {
  getCustomer(id);
  const d = clean(input, true);
  const cols = Object.keys(d);
  if (cols.length) guard(() => db.prepare(`UPDATE customers SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => d[c]), Number(id)));
  return getCustomer(id);
}

export function deleteCustomer(id) {
  getCustomer(id);
  db.prepare('UPDATE sales SET customer_id = NULL WHERE customer_id = ?').run(Number(id));
  db.prepare('DELETE FROM customers WHERE id = ?').run(Number(id));
  return { deleted: true };
}

// ---- loyalty (call inside a transaction) ----
export function loyaltyConfig() { return getGroup('loyalty'); }

/** Minor-unit discount for redeeming `points`, after validating balance and minimum. */
export function redemptionValue(customerId, points) {
  const cfg = loyaltyConfig();
  const p = Math.floor(Number(points) || 0);
  if (!p) return { points: 0, amount: 0 };
  if (!cfg.enabled) throw badRequest('Loyalty is turned off');
  if (!customerId) throw badRequest('Pick a customer to redeem points');
  if (p < cfg.minRedeem) throw badRequest(`Redeem at least ${cfg.minRedeem} points`);
  const c = getCustomer(customerId);
  if (p > c.points) throw badRequest(`Customer only has ${c.points} points`);
  return { points: p, amount: toMinor(p * cfg.pointValue) };
}

/** Points earned on a spend; members earn with their plan's multiplier. */
export function pointsFor(totalMinor, customerId = null) {
  const cfg = loyaltyConfig();
  if (!cfg.enabled || cfg.earnPer <= 0) return 0;
  const base = Math.floor(totalMinor / toMinor(cfg.earnPer)) * cfg.earnPoints;
  if (!customerId) return base;
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  const plan = activePlan(c);
  return Math.floor(base * (plan ? plan.points_multiplier : 1));
}

export function adjustPoints(customerId, delta) {
  if (!customerId || !delta) return;
  db.prepare('UPDATE customers SET points = MAX(0, points + ?) WHERE id = ?').run(delta, customerId);
}

export function recordVisit(customerId, totalMinor) {
  db.prepare('UPDATE customers SET visits = visits + 1, total_spent = total_spent + ?, last_visit = ? WHERE id = ?').run(totalMinor, nowIso(), customerId);
}
