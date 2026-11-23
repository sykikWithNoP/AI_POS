// Customers + loyalty, memberships, shifts/cash drawer, refunds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-pro-'));
process.env.DATA_DIR = dir;
process.env.DB_FILE = path.join(dir, 'pos.db');
const { createApp } = await import('../server/index.js');
const server = createApp().listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const B = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const setupRes = await fetch(`${B}/api/auth/setup`, { method: 'POST', headers: { 'X-POS-Client': '1', 'Content-Type': 'application/json' }, body: '{"pin":"1357"}' });
const COOKIE = setupRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const call = async (method, p, body) => {
  const res = await fetch(B + p, { method, headers: { 'X-POS-Client': '1', 'Content-Type': 'application/json', Cookie: COOKIE }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[1]} -> ${r.status} ${JSON.stringify(r.json)}`); return r.json; };

let item, cust, gold, shift;

test('setup: item, customer, plan, shift', async () => {
  item = await ok('POST', '/api/items', { name: 'Coffee', price: 200, cost: 50, stock: 50, tax_rate: 0 });
  cust = await ok('POST', '/api/customers', { name: 'Sita', phone: '9800000001' });
  assert.equal((await call('POST', '/api/customers', { name: 'Dup', phone: '9800000001' })).status, 409);
  gold = await ok('POST', '/api/membership-plans', { name: 'Gold', discount_percent: 10, points_multiplier: 2, fee: 1000, duration_days: 365 });
  shift = await ok('POST', '/api/shifts/open', { float: 1000 });
  assert.equal((await call('POST', '/api/shifts/open', { float: 0 })).status, 409);
});

test('membership is sold through a sale and activates on payment', async () => {
  assert.equal((await call('POST', '/api/sales', { lines: [{ membershipPlanId: gold.id }] })).status, 400); // needs customer
  const sale = await ok('POST', '/api/sales', { customerId: cust.id, lines: [{ membershipPlanId: gold.id }] });
  assert.equal(sale.total, 100000 + 13000); // fee + default VAT
  let c = await ok('GET', `/api/customers/${cust.id}`);
  assert.equal(c.membership, null);
  await ok('POST', `/api/sales/${sale.id}/payments`, { method: 'cash', tendered: 1130 });
  c = await ok('GET', `/api/customers/${cust.id}`);
  assert.equal(c.membership.name, 'Gold');
  assert.ok(Date.parse(c.membership.until) > Date.now() + 360 * 86400_000);
  assert.equal(c.points, 11 * 2); // Rs 1130 -> 11 base points x2 multiplier
});

test('member pricing + loyalty earn/redeem', async () => {
  const q = await ok('POST', '/api/sales/quote', { customerId: cust.id, lines: [{ itemId: item.id, qty: 5 }] });
  assert.equal(q.member.amount, 10000); // 10% of Rs 1000
  assert.equal(q.total, 90000);
  assert.equal((await call('POST', '/api/sales/quote', { customerId: cust.id, redeemPoints: 10, lines: [{ itemId: item.id, qty: 1 }] })).status, 400); // below min 50
  await ok('POST', `/api/customers/${cust.id}/points`, { delta: 100 });
  const sale = await ok('POST', '/api/sales', { customerId: cust.id, redeemPoints: 50, lines: [{ itemId: item.id, qty: 5 }] });
  // 1000 - member 10% (on goods after other discounts: (1000-50)*10% = 95) - 50 redeemed
  assert.equal(sale.total, 100000 - 5000 - 9500);
  assert.equal((await ok('GET', `/api/customers/${cust.id}`)).points, 122 - 50);
  await ok('POST', `/api/sales/${sale.id}/payments`, { method: 'cash', tendered: 900 });
  const c = await ok('GET', `/api/customers/${cust.id}`);
  assert.equal(c.points, 72 + 8 * 2);
  assert.equal(c.visits, 2);
});

test('partial refund returns stock, reverses points, counts in shift', async () => {
  const sale = await ok('POST', '/api/sales', { lines: [{ itemId: item.id, qty: 3 }] });
  await ok('POST', `/api/sales/${sale.id}/payments`, { method: 'cash', tendered: 600 });
  const line = sale.items[0];
  assert.equal((await call('POST', `/api/sales/${sale.id}/refunds`, { lines: [{ saleItemId: line.id, qty: 4 }], reason: 'x' })).status, 400);
  const r = await ok('POST', `/api/sales/${sale.id}/refunds`, { lines: [{ saleItemId: line.id, qty: 1 }], method: 'cash', reason: 'Spilled' });
  assert.equal(r.refund.amount, 20000);
  assert.match(r.refund.credit_note, /^CN-/);
  assert.equal(r.sale.refunded, 20000);
  assert.equal((await call('POST', `/api/sales/${sale.id}/void`, { reason: 'x' })).status, 409);
  const stock = (await ok('GET', `/api/items/${item.id}`)).stock;
  assert.equal(stock, 50 - 5 - 3 + 1);
});

test('cash drawer: pay in/out, close with variance and Z report', async () => {
  await ok('POST', '/api/shifts/cash', { kind: 'out', amount: 100, reason: 'Milk' });
  await ok('POST', '/api/shifts/cash', { kind: 'in', amount: 50, reason: 'Change top-up' });
  const cur = await ok('GET', '/api/shifts/current');
  // float 1000 + cash sales (1130 + 855 + 600) - refund 200 + 50 - 100
  assert.equal(cur.report.cash.expected, 100000 + 113000 + 85500 + 60000 - 20000 + 5000 - 10000);
  const z = await ok('POST', '/api/shifts/close', { counted: 3335 });
  assert.equal(z.variance, 333500 - cur.report.cash.expected);
  assert.equal(z.sales.bills, 3);
  assert.equal(z.refundTotal, 20000);
  assert.equal((await ok('GET', '/api/shifts/current')).shift, null);
});

test('comp membership and cancel', async () => {
  const c2 = await ok('POST', '/api/customers', { name: 'Hari' });
  const c = await ok('POST', `/api/customers/${c2.id}/membership`, { planId: gold.id });
  assert.equal(c.membership.name, 'Gold');
  const off = await ok('DELETE', `/api/customers/${c2.id}/membership`);
  assert.equal(off.membership, null);
});

test('pay later: off by default, then issues bill, takes stock, collects later', async () => {
  const { setGroup } = await import('../server/services/settings.js');
  const s1 = await ok('POST', '/api/sales', { lines: [{ itemId: item.id, qty: 2 }] });
  assert.equal((await call('POST', `/api/sales/${s1.id}/postpone`)).status, 400);
  setGroup('checkout', { allowPostpone: true, postponeRequiresCustomer: true });
  assert.equal((await call('POST', `/api/sales/${s1.id}/postpone`)).status, 400); // needs a customer
  const before = (await ok('GET', `/api/items/${item.id}`)).stock;
  const s2 = await ok('POST', '/api/sales', { customerId: cust.id, lines: [{ itemId: item.id, qty: 2 }] });
  const p = await ok('POST', `/api/sales/${s2.id}/postpone`, {});
  assert.equal(p.postponed, 1);
  assert.ok(p.due_date);
  assert.equal((await ok('GET', `/api/items/${item.id}`)).stock, before - 2);
  assert.equal((await ok('GET', `/api/customers/${cust.id}`)).outstanding, s2.total);
  assert.equal((await ok('GET', '/api/outstanding')).bills, 1);
  await ok('POST', `/api/sales/${s2.id}/payments`, { method: 'cash', tendered: 10000 });
  assert.equal((await ok('GET', `/api/items/${item.id}`)).stock, before - 2); // not taken twice
  assert.equal((await ok('GET', `/api/customers/${cust.id}`)).outstanding, 0);
});

test('default tier for new customers and setting tier from settings', async () => {
  const { setGroup } = await import('../server/services/settings.js');
  setGroup('memberships', { defaultPlanId: gold.id });
  const c = await ok('POST', '/api/customers', { name: 'Gita' });
  assert.equal(c.membership.name, 'Gold');
  const none = await ok('PUT', `/api/customers/${c.id}/tier`, { planId: 0 });
  assert.equal(none.membership, null);
  setGroup('memberships', { defaultPlanId: 0 });
});
