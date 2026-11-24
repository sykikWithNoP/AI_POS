// Stock, variants, reports, backups, updates, printing, sealed key, i18n.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-feat-'));
process.env.DATA_DIR = dir;
process.env.DB_FILE = path.join(dir, 'pos.db');
const { createApp } = await import('../server/index.js');
const { db } = await import('../server/db.js');
const server = createApp().listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const B = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const setupRes = await fetch(`${B}/api/auth/setup`, { method: 'POST', headers: { 'X-POS-Client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '8642', username: 'owner', password: 'correct horse battery 9' }) });
const COOKIE = setupRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const call = async (method, p, body) => {
  const res = await fetch(B + p, { method, headers: { 'X-POS-Client': '1', 'Content-Type': 'application/json', Cookie: COOKIE }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let json; try { json = JSON.parse(t); } catch { json = t; }
  return { status: res.status, json, headers: res.headers };
};
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[1]} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); return r.json; };

let rice;
test('stock: opening, stock-in with cost, sale, refund, adjustment — all in history', async () => {
  rice = await ok('POST', '/api/items', { name: 'Rice 1kg', price: 150, cost: 100, stock: 10, tax_rate: 0 });
  await ok('POST', '/api/stock/in', { supplier: 'Wholesaler', ref: 'B-77', lines: [{ itemId: rice.id, qty: 20, unitCost: 110, updateCost: true }] });
  assert.equal((await ok('GET', `/api/items/${rice.id}`)).stock, 30);
  assert.equal((await ok('GET', `/api/items/${rice.id}`)).cost, 11000);
  const s = await ok('POST', '/api/sales', { lines: [{ itemId: rice.id, qty: 3 }] });
  await ok('POST', `/api/sales/${s.id}/payments`, { method: 'cash', tendered: 500 });
  await ok('POST', `/api/sales/${s.id}/refunds`, { lines: [{ saleItemId: s.items[0].id, qty: 1 }], reason: 'torn bag' });
  const adj = await ok('POST', '/api/stock/adjust', { itemId: rice.id, newQty: 25, reason: 'damaged', note: 'water' });
  assert.equal(adj.stock, 25);
  const hist = await ok('GET', `/api/stock/history?itemId=${rice.id}`);
  assert.deepEqual(hist.map((m) => m.kind).reverse(), ['opening', 'in', 'sale', 'refund', 'adjust']);
  assert.deepEqual(hist.map((m) => m.balance).reverse(), [10, 30, 27, 28, 25]);
  assert.throws(() => db.prepare('DELETE FROM stock_movements').run(), /append-only/);
  assert.equal((await call('POST', '/api/stock/adjust', { itemId: rice.id, newQty: 25, reason: 'bogus' })).status, 400);
});

test('variants & add-ons are priced by the server', async () => {
  const coffee = await ok('POST', '/api/items', { name: 'Coffee', price: 150, tax_rate: 0, options: [
    { name: 'Size', required: true, choices: [{ name: 'Small', price: -20 }, { name: 'Large', price: 40 }] },
    { name: 'Extras', multi: true, choices: [{ name: 'Extra shot', price: 50 }, { name: 'Oat milk', price: 30 }] },
  ] });
  assert.equal(coffee.options[1].choices[0].price, 5000);
  assert.equal((await call('POST', '/api/sales/quote', { lines: [{ itemId: coffee.id, qty: 1 }] })).status, 400); // size required
  assert.equal((await call('POST', '/api/sales/quote', { lines: [{ itemId: coffee.id, qty: 1, options: [{ group: 'Size', choice: 'Huge' }] }] })).status, 400);
  assert.equal((await call('POST', '/api/sales/quote', { lines: [{ itemId: coffee.id, qty: 1, options: [{ group: 'Size', choice: 'Small' }, { group: 'Size', choice: 'Large' }] }] })).status, 400);
  const s = await ok('POST', '/api/sales', { lines: [{ itemId: coffee.id, qty: 2, unitPrice: 1, options: [{ group: 'Size', choice: 'Large' }, { group: 'Extras', choice: 'Extra shot' }, { group: 'Extras', choice: 'Oat milk' }] }] });
  assert.equal(s.items[0].name, 'Coffee (Large, Extra shot, Oat milk)');
  assert.equal(s.items[0].unit_price, 27000);
  assert.equal(s.total, 54000);
  assert.equal((await call('POST', '/api/items', { name: 'Bad', price: 1, options: [{ name: 'X', choices: [] }] })).status, 400);
});
