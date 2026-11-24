// Integration test: real HTTP server on an ephemeral port with a throwaway database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-test-'));
process.env.DATA_DIR = dir;
process.env.DB_FILE = path.join(dir, 'pos.db');

const { createApp } = await import('../server/index.js');
const { startNotifiers } = await import('../server/notifiers.js');
const settings = await import('../server/services/settings.js');
const { verifyWebhook } = await import('../server/providers/stripe.js');
const esewa = await import('../server/providers/esewa.js');

startNotifiers();
const server = createApp().listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const B = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// First run: create the owner PIN; the response sets session + elevation cookies.
const setupRes = await fetch(`${B}/api/auth/setup`, { method: 'POST', headers: { 'X-POS-Client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468', username: 'owner', password: 'correct horse battery 9' }) });
let COOKIE = setupRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const call = async (method, p, body, headers = {}) => {
  const res = await fetch(B + p, { method, headers: { 'X-POS-Client': '1', 'Content-Type': 'application/json', Cookie: COOKIE, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
};

test('item CRUD with validation', async () => {
  const bad = await call('POST', '/api/items', { name: '', price: 10 });
  assert.equal(bad.status, 400);
  const c = await call('POST', '/api/items', { name: 'Tea', price: '40', stock: 10, sku: 'TEA' });
  assert.equal(c.status, 201);
  assert.equal(c.json.price, 4000);
  const dup = await call('POST', '/api/items', { name: 'Tea 2', price: 1, sku: 'TEA' });
  assert.equal(dup.status, 409);
  const u = await call('PUT', `/api/items/${c.json.id}`, { price: 45 });
  assert.equal(u.json.price, 4500);
  const d = await call('POST', '/api/items', { name: 'Temp', price: 1 });
  assert.equal((await call('DELETE', `/api/items/${d.json.id}`)).json.deleted, true);
  assert.equal((await call('GET', `/api/items/${d.json.id}`)).status, 404);
});

test('mutations without X-POS-Client are rejected (CSRF guard)', async () => {
  const res = await fetch(`${B}/api/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: COOKIE }, body: '{"name":"x","price":1}' });
  assert.equal(res.status, 403);
});

test('server prices items from the catalog, not the client', async () => {
  const item = (await call('GET', '/api/items')).json.find((i) => i.sku === 'TEA');
  const s = await call('POST', '/api/sales', { lines: [{ itemId: item.id, qty: 2, unitPrice: 1 }] });
  assert.equal(s.status, 201);
  assert.equal(s.json.subtotal, 9000);
  assert.equal(s.json.total, 10170);
  assert.match(s.json.invoice_no, /^INV-\d{4}-00001$/);
});

test('split payment: card then cash with change; stock decremented once', async () => {
  const item = (await call('GET', '/api/items')).json.find((i) => i.sku === 'TEA');
  const s = (await call('POST', '/api/sales', { lines: [{ itemId: item.id, qty: 1 }] })).json;
  const p1 = await call('POST', `/api/sales/${s.id}/payments`, { method: 'card', amount: 20, confirm: true });
  assert.equal(p1.json.sale.status, 'pending');
  const p2 = await call('POST', `/api/sales/${s.id}/payments`, { method: 'cash', tendered: 100 });
  assert.equal(p2.json.sale.status, 'paid');
  assert.equal(p2.json.sale.change_due, 10000 - (s.total - 2000));
  const after = (await call('GET', `/api/items/${item.id}`)).json;
  assert.equal(after.stock, 9);
  const again = await call('POST', `/api/sales/${s.id}/payments`, { method: 'cash', tendered: 1 });
  assert.equal(again.status, 409);
  const v = await call('POST', `/api/sales/${s.id}/void`, { reason: 'test' });
  assert.equal(v.json.status, 'void');
  assert.equal((await call('GET', `/api/items/${item.id}`)).json.stock, 10);
});

test('generic webhook: signature required, amount checked, idempotent', async () => {
  settings.setGroup('genericWebhook', { enabled: true, secret: 'whsec_test' });
  const s = (await call('POST', '/api/sales', { lines: [{ name: 'Service', unitPrice: 100, qty: 1, taxRate: 0 }] })).json;
  const send = (obj, secret = 'whsec_test') => {
    const body = JSON.stringify(obj);
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return fetch(`${B}/api/webhooks/generic`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-POS-Signature': sig }, body }).then(async (r) => ({ status: r.status, json: await r.json() }));
  };
  assert.equal((await send({ invoice_no: s.invoice_no, amount: 100, reference: 'R1' }, 'wrong')).status, 401);
  assert.equal((await send({ invoice_no: s.invoice_no, amount: 999, reference: 'R1' })).status, 400);
  const ok = await send({ invoice_no: s.invoice_no, amount: 100, reference: 'R1' });
  assert.equal(ok.json.changed, true);
  const dup = await send({ invoice_no: s.invoice_no, amount: 100, reference: 'R1' });
  assert.ok(dup.json.ignored || dup.json.duplicate);
  assert.equal((await call('GET', `/api/sales/${s.id}`)).json.status, 'paid');
});

test('API keys: scoped bearer access, never shown again', async () => {
  const k = (await call('POST', '/api/keys', { name: 'reader', scopes: ['read'] })).json;
  assert.match(k.key, /^pos_/);
  const list = (await call('GET', '/api/keys')).json;
  assert.ok(!JSON.stringify(list).includes(k.key));
  const auth = { Authorization: `Bearer ${k.key}` };
  assert.equal((await fetch(`${B}/api/items`, { headers: auth })).status, 200);
  assert.equal((await fetch(`${B}/api/items`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"name":"x","price":1}' })).status, 403);
  assert.equal((await fetch(`${B}/api/settings`, { headers: auth })).status, 403);
  assert.equal((await fetch(`${B}/api/items`, { headers: { Authorization: 'Bearer pos_nope' } })).status, 401);
});

test('secrets are encrypted at rest and never returned to the browser', async () => {
  await call('PUT', '/api/settings/ai', { values: { apiKey: 'sk-ant-SECRET-1234' } });
  const pub = (await call('GET', '/api/settings')).json;
  assert.ok(!JSON.stringify(pub).includes('SECRET'));
  assert.ok(!JSON.stringify(pub).includes('1234'));
  assert.equal(pub.ai.apiKeySet, true);
  const { db } = await import('../server/db.js');
  const raw = db.prepare("SELECT value FROM settings WHERE key = 'ai'").get().value;
  assert.ok(!raw.includes('SECRET'));
  // Masked placeholder sent back must not overwrite the real key.
  await call('PUT', '/api/settings/ai', { values: { apiKey: '••••••••' } });
  assert.equal(settings.getGroup('ai').apiKey, 'sk-ant-SECRET-1234');
});

test('lock screen requires the PIN to open the dashboard', async () => {
  await call('PUT', '/api/settings/security', { values: { lockScreen: true } });
  const noCookie = await fetch(`${B}/api/bootstrap`, { headers: { 'X-POS-Client': '1' } });
  assert.equal(noCookie.status, 401);
  assert.equal((await call('GET', '/api/bootstrap')).status, 200);
  await call('PUT', '/api/settings/security', { values: { lockScreen: false } });
});

test('online bill page renders and unknown tokens 404', async () => {
  const s = (await call('GET', '/api/sales')).json[0];
  const page = await fetch(`${B}/b/${s.public_token}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(s.invoice_no));
  assert.equal((await fetch(`${B}/b/nope`)).status, 404);
});

test('IRD dry run marks the bill synced without sending', async () => {
  settings.setGroup('ird', { enabled: true, dryRun: true, sellerPan: '123456789' });
  const s = (await call('POST', '/api/sales', { lines: [{ name: 'X', unitPrice: 10, qty: 1 }] })).json;
  await call('POST', `/api/sales/${s.id}/payments`, { method: 'cash', tendered: 20 });
  await new Promise((r) => setTimeout(r, 100));
  const after = (await call('GET', `/api/sales/${s.id}`)).json;
  assert.equal(after.ird_status, 'synced');
  assert.equal(after.ird_response.dryRun, true);
  assert.equal(after.ird_response.payload.password, '');
  settings.setGroup('ird', { enabled: false });
});

test('provider signatures', () => {
  const t = Math.floor(Date.now() / 1000);
  const body = '{"a":1}';
  const sig = crypto.createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex');
  assert.equal(verifyWebhook('whsec_x', body, `t=${t},v1=${sig}`), true);
  assert.equal(verifyWebhook('whsec_x', body, `t=${t},v1=deadbeef`), false);
  assert.equal(verifyWebhook('whsec_x', body, `t=${t - 1000},v1=${sig}`), false);
  // eSewa: a return payload we sign verifies; a tampered one does not.
  const cfg = { sandbox: true, secretKey: '' };
  const ret = { transaction_code: 'X1', status: 'COMPLETE', total_amount: '100.0', transaction_uuid: 'INV-8384-00001-1', product_code: 'EPAYTEST', signed_field_names: 'transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names' };
  ret.signature = esewa.sign(esewa.SANDBOX_SECRET, ret, ret.signed_field_names);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  assert.equal(esewa.decodeReturn(cfg, enc(ret)).valid, true);
  assert.equal(esewa.decodeReturn(cfg, enc({ ...ret, total_amount: '1.0' })).valid, false);
});
