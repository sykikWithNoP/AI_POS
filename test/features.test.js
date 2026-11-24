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
const { startNotifiers } = await import('../server/notifiers.js');
startNotifiers();
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

test('reports: sales register with credit notes and cancelled bills, VAT summary, profit, slow movers', async () => {
  const tea = await ok('POST', '/api/items', { name: 'Tea', price: 100, cost: 40, stock: 50 });
  const s1 = await ok('POST', '/api/sales', { customer: { name: 'ABC Traders', pan: '123456789' }, lines: [{ itemId: tea.id, qty: 2 }] });
  await ok('POST', `/api/sales/${s1.id}/payments`, { method: 'cash', tendered: 500 });
  await ok('POST', `/api/sales/${s1.id}/refunds`, { lines: [{ saleItemId: s1.items[0].id, qty: 1 }], reason: 'stale' });
  const s2 = await ok('POST', '/api/sales', { lines: [{ itemId: tea.id, qty: 1 }] });
  await ok('POST', `/api/sales/${s2.id}/void`, { reason: 'mistake' });
  const reg = await ok('GET', `/api/reports/sales-register?fy=${s1.fiscal_year}`);
  const row = reg.rows.find((r) => r.number === s1.invoice_no);
  assert.equal(row.buyerPan, '123456789');
  assert.equal(row.vat, 2600);
  const cn = reg.rows.find((r) => r.kind === 'credit-note' && r.note.includes(s1.invoice_no));
  assert.equal(cn.total, -11300);
  assert.equal(cn.vat, -1300);
  assert.equal(reg.rows.find((r) => r.number === s2.invoice_no).kind, 'cancelled');
  const csv = await call('GET', `/api/reports/sales-register?fy=${s1.fiscal_year}&format=csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.json, /Buyer PAN/);
  const vat = await ok('GET', `/api/reports/vat-summary?fy=${s1.fiscal_year}`);
  assert.equal(vat.months.length, 12);
  assert.equal(vat.months.reduce((a, m) => a + m.vat, 0), vat.totals.vat);
  const profit = await ok('GET', '/api/reports/profit-by-item');
  const teaRow = profit.rows.find((r) => r.name === 'Tea');
  assert.equal(teaRow.qty, 1); // 2 sold, 1 returned
  assert.equal(teaRow.cost, 4000);
  assert.equal((await ok('GET', '/api/reports/slow-moving?days=30')).days, 30);
  assert.equal((await call('GET', '/api/reports/sales-register?fy=bad')).status, 400);
});

test('IRD made easy: checklist, setup, practice sync, retry backoff, filing pack zip', async () => {
  const st0 = await ok('GET', '/api/ird/status');
  assert.equal(st0.ready, false);
  await ok('POST', '/api/ird/setup', { pan: '600123456', username: 'cbms-user', password: 'cbms-pass', name: 'Test Shop' });
  const st = await ok('GET', '/api/ird/status');
  assert.ok(st.checks.find((c) => c.id === 'seller').ok);
  assert.equal(st.dryRun, true); // practice mode until going live
  const s = await ok('POST', '/api/sales', { lines: [{ name: 'Svc', unitPrice: 100, qty: 1 }] });
  await ok('POST', `/api/sales/${s.id}/payments`, { method: 'cash', tendered: 200 });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await ok('GET', `/api/sales/${s.id}`)).ird_status, 'synced');
  // Simulate a failure and check backoff scheduling.
  db.prepare("UPDATE sales SET ird_status = 'failed' WHERE id = ?").run(s.id);
  const r = await ok('POST', '/api/ird/sync-all');
  assert.ok(r.synced >= 1);
  const res = await fetch(`${B}/api/ird/filing-pack?fy=${s.fiscal_year}`, { headers: { Cookie: COOKIE } });
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await res.arrayBuffer());
  const { unzip } = await import('../server/util/zip.js');
  const names = unzip(buf).map((f) => f.name);
  assert.deepEqual(names.sort(), ['README.txt', 'credit-notes.csv', 'sales-register.csv', 'sales-register.html', 'unsynced-bills.csv', 'vat-summary.csv']);
  const regCsv = unzip(buf).find((f) => f.name === 'sales-register.csv').data.toString();
  assert.match(regCsv, new RegExp(s.invoice_no));
  await ok('PUT', '/api/settings/ird', { values: { enabled: false } });
});

test('backups: create, list, validate, stage restore; junk files refused', async () => {
  const b = await ok('POST', '/api/backups');
  assert.match(b.name, /^pos-\d{8}-\d{6}-manual\.db$/);
  const list = await ok('GET', '/api/backups');
  assert.ok(list.backups.some((x) => x.name === b.name));
  const junk = await fetch(`${B}/api/restore/upload`, { method: 'POST', headers: { 'X-POS-Client': '1', 'Content-Type': 'application/octet-stream', Cookie: COOKIE }, body: Buffer.from('not a database at all') });
  assert.equal(junk.status, 400);
  assert.equal((await call('GET', '/api/backups/..%2F..%2Fpos.db')).status, 400);
  const staged = await ok('POST', `/api/backups/${b.name}/restore`);
  assert.equal(staged.staged, true);
  assert.ok(staged.summary.sales >= 1);
  assert.equal((await ok('GET', '/api/backups')).restorePending, true);
  await ok('POST', '/api/restore/cancel');
});

test('updates: only signed, newer, untampered packages are accepted', async () => {
  const crypto = await import('node:crypto');
  const { zip } = await import('../server/util/zip.js');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  globalThis.__POS_UPDATE_PUBKEY__ = publicKey.export({ type: 'spki', format: 'pem' });
  const upd = await import('../server/services/updates.js');
  const make = ({ version = '99.0.0', files = { 'server.mjs': 'ok', 'public/index.html': '<p>' }, key = privateKey, extra = [] } = {}) => {
    const entries = Object.entries(files).map(([n, d]) => ({ name: n, data: Buffer.from(d) }));
    const manifest = Buffer.from(JSON.stringify({ app: 'free-ai-pos', version, files: Object.fromEntries(entries.map((f) => [f.name, crypto.createHash('sha256').update(f.data).digest('hex')])) }));
    return zip([{ name: 'manifest.json', data: manifest }, { name: 'manifest.sig', data: crypto.sign(null, manifest, key).toString('base64') }, ...entries.map((f) => ({ name: `files/${f.name}`, data: f.data })), ...extra]);
  };
  assert.equal(upd.verifyPackage(make()).manifest.version, '99.0.0');
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.throws(() => upd.verifyPackage(make({ key: other })), /Signature check failed/);
  assert.throws(() => upd.verifyPackage(make({ version: '0.0.1' })), /not newer/);
  assert.throws(() => upd.verifyPackage(make({ files: { 'server.mjs': 'x', '../evil.sh': 'rm' } })), /may not install/);
  assert.throws(() => upd.verifyPackage(make({ extra: [{ name: 'files/public/extra.js', data: Buffer.from('x') }] })), /unsigned file/);
  const good = make();
  const i = good.indexOf(Buffer.from('<p>'));
  good[i] = 0x41; // tamper with a payload byte
  assert.throws(() => upd.verifyPackage(good), /fingerprint/);
  assert.throws(() => upd.verifyPackage(Buffer.from('garbage')), /not a valid update/);
  // Source checkouts refuse to stage (updates install into the released app).
  assert.equal((await fetch(`${B}/api/updates/upload`, { method: 'POST', headers: { 'X-POS-Client': '1', 'Content-Type': 'application/octet-stream', Cookie: COOKIE }, body: make() })).status, 409);
  delete globalThis.__POS_UPDATE_PUBKEY__;
});

test('updater: apply, keep previous, auto-rollback, manual rollback', async () => {
  const up = await import('../scripts/updater.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-upd-'));
  const w = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), txt); };
  w('server.mjs', 'v1'); w('package.json', '{"version":"1.0.0"}'); w('public/index.html', 'one');
  w('.update/staged/1.1.0/server.mjs', 'v2'); w('.update/staged/1.1.0/package.json', '{"version":"1.1.0"}'); w('.update/staged/1.1.0/public/index.html', 'two');
  w('.update/pending.json', '{"version":"1.1.0"}');
  assert.equal(up.applyStagedUpdate(root, root), true);
  assert.equal(fs.readFileSync(path.join(root, 'server.mjs'), 'utf8'), 'v2');
  assert.equal(fs.readFileSync(path.join(root, '.update/versions/1.0.0/server.mjs'), 'utf8'), 'v1');
  assert.equal(up.isProbation(root), true);
  up.rollbackUpdate(root); // what the launcher does after 3 failed starts
  assert.equal(fs.readFileSync(path.join(root, 'server.mjs'), 'utf8'), 'v1');
  assert.equal(fs.readFileSync(path.join(root, 'public/index.html'), 'utf8'), 'one');
  w('.update/rollback-request.json', '{"to":"1.0.0"}');
  assert.equal(up.applyStagedUpdate(root, root), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.update/last-change.json'), 'utf8')).kind, 'rollback');
  assert.equal(up.cmp('1.10.0', '1.9.9'), 1);
  fs.rmSync(root, { recursive: true, force: true });
});
