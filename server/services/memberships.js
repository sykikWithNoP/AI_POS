// Membership plans: a paid (or free/comp) tier that gives members an automatic discount
// and a loyalty-points multiplier for a period (duration_days = 0 means lifetime).
import { db, nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../lib.js';
import { emit, notify } from '../bus.js';
import { toMinor } from '../../shared/billing.js';

const out = (p) => p && ({ ...p, active: !!p.active });

export const listPlans = ({ all } = {}) => db.prepare(`SELECT * FROM membership_plans ${all ? '' : 'WHERE active = 1'} ORDER BY fee, name`).all().map(out);

export function getPlan(id) {
  const p = db.prepare('SELECT * FROM membership_plans WHERE id = ?').get(Number(id));
  if (!p) throw notFound('Membership plan');
  return out(p);
}

function clean(input, partial) {
  const o = {};
  const num = (k, min, max) => { if (k in input) { const v = Number(input[k]); if (!Number.isFinite(v) || v < min || v > max) throw badRequest(`${k} must be between ${min} and ${max}`); o[k] = v; } };
  if ('name' in input || !partial) { o.name = String(input.name || '').trim().slice(0, 60); if (!o.name) throw badRequest('Plan name is required'); }
  num('discount_percent', 0, 100); num('points_multiplier', 0, 100); num('duration_days', 0, 36500);
  if ('duration_days' in o) o.duration_days = Math.round(o.duration_days);
  if ('fee' in input) { o.fee = toMinor(input.fee || 0); if (o.fee < 0) throw badRequest('Fee cannot be negative'); }
  if ('color' in input) o.color = String(input.color || '').slice(0, 20) || null;
  if ('perks' in input) o.perks = String(input.perks || '').slice(0, 300) || null;
  if ('active' in input) o.active = input.active === false || input.active === 'false' ? 0 : 1;
  return o;
}
const guard = (fn) => { try { return fn(); } catch (e) { if (String(e.message).includes('UNIQUE')) throw conflict('A plan with that name exists'); throw e; } };

export function createPlan(input) {
  const d = clean(input, false);
  const cols = Object.keys(d);
  const r = guard(() => db.prepare(`INSERT INTO membership_plans (${cols}) VALUES (${cols.map(() => '?')})`).run(...cols.map((c) => d[c])));
  return getPlan(r.lastInsertRowid);
}
export function updatePlan(id, input) {
  getPlan(id);
  const d = clean(input, true);
  const cols = Object.keys(d);
  if (cols.length) guard(() => db.prepare(`UPDATE membership_plans SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => d[c]), Number(id)));
  return getPlan(id);
}
export function deletePlan(id) {
  getPlan(id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE plan_id = ?').get(Number(id)).n;
  if (used) { db.prepare('UPDATE membership_plans SET active = 0 WHERE id = ?').run(Number(id)); return { archived: true, members: used }; }
  db.prepare('DELETE FROM membership_plans WHERE id = ?').run(Number(id));
  return { deleted: true };
}

/** The customer's plan if their membership is current, else null. */
export function activePlan(customer, at = new Date()) {
  if (!customer?.plan_id) return null;
  if (customer.member_until && Date.parse(customer.member_until) <= at.getTime()) return null;
  const p = db.prepare('SELECT * FROM membership_plans WHERE id = ?').get(customer.plan_id);
  return p ? out(p) : null;
}

/** Start or extend a membership. Renewing the same plan stacks on the remaining time. */
export function activate(customerId, planId, { via = 'sale' } = {}) {
  const plan = getPlan(planId);
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customerId));
  if (!c) throw notFound('Customer');
  const now = Date.now();
  const stillValid = c.plan_id === plan.id && (!c.member_until || Date.parse(c.member_until) > now);
  const base = stillValid && c.member_until ? Date.parse(c.member_until) : now;
  const until = plan.duration_days === 0 ? null : new Date(base + plan.duration_days * 86400_000).toISOString();
  db.prepare('UPDATE customers SET plan_id = ?, member_since = COALESCE(CASE WHEN plan_id = ? THEN member_since END, ?), member_until = ? WHERE id = ?')
    .run(plan.id, plan.id, nowIso(), until, c.id);
  notify({ type: 'membership.activated', level: 'success', title: `${c.name} is now ${plan.name}`, body: until ? `Valid until ${until.slice(0, 10)}` : 'Lifetime', data: { customerId: c.id, via } });
  emit('membership.activated', { customerId: c.id, planId: plan.id, until });
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(c.id);
}

/** Set a customer's tier directly from Settings: planId 0/null removes it. */
export function setTier(customerId, planId) {
  return Number(planId) ? activate(customerId, Number(planId), { via: 'settings' }) : cancelMembership(customerId);
}

export function cancelMembership(customerId) {
  const r = db.prepare('UPDATE customers SET plan_id = NULL, member_until = NULL, member_since = NULL WHERE id = ?').run(Number(customerId));
  if (!r.changes) throw notFound('Customer');
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customerId));
}

export const planStats = () => db.prepare(`SELECT p.id, p.name, COUNT(c.id) AS members FROM membership_plans p LEFT JOIN customers c ON c.plan_id = p.id
  AND (c.member_until IS NULL OR c.member_until > ?) GROUP BY p.id`).all(nowIso());
