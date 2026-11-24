// Ease-of-use features: welcome wizard, open-bill mirror, built-in guide, USB backups,
// connector "proven" ticks, start-with-computer, update-check validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-easy-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-usb-'));
process.env.DATA_DIR = dir;
process.env.DB_FILE = path.join(dir, 'pos.db');
process.env.POS_AUTOSTART_DIR = path.join(outside, 'autostart');
process.env.POS_TEST = '1';
const { createApp } = await import('../server/index.js');
const { db } = await import('../server/db.js');
const server = createApp().listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const B = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
const setupRes = await fetch(`${B}/api/auth/setup`, { method: 'POST', headers: { 'X-POS-Client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468', username: 'owner', password: 'correct horse battery 9' }) });
const COOKIE = setupRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const call = async (method, p, body, headers = {}) => {
  const res = await fetch(B + p, { method, headers: { 'X-POS-Client': '1', 'Content-Type': 'application/json', Cookie: COOKIE, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let json; try { json = JSON.parse(t); } catch { json = t; }
  return { status: res.status, json, text: t };
};
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[1]} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); return r.json; };

test('welcome wizard: shown once for a new POS, applies the answers, then never again', async () => {
  assert.equal((await ok('GET', '/api/bootstrap')).welcome, true);
  const samples = await ok('GET', '/api/onboarding/samples?type=restaurant');
  assert.ok(samples.some((s) => /momo/i.test(s.name)));
  assert.equal((await call('POST', '/api/onboarding', { business: { name: '  ' } })).status, 400);
  const r = await ok('POST', '/api/onboarding', {
    business: { name: 'Test Café', phone: '01-555', pan: '600000001' }, businessType: 'restaurant', vat: true, pricesIncludeTax: true, serviceCharge: true,
    sample: true, items: [{ name: 'House special', price: 450, category: 'Food' }, { name: '', price: 5 }, { name: 'Free', price: 0 }],
    methods: { card: false, qr: true, esewa: true, khalti: true, stripe: true },
  });
  assert.equal(r.itemsCreated, samples.length + 1);
  assert.deepEqual(r.finishInConnectors.sort(), ['esewa', 'khalti', 'stripe']);
  const boot = await ok('GET', '/api/bootstrap');
  assert.equal(boot.welcome, false);
  assert.equal(boot.settings.business.name, 'Test Café');
  assert.deepEqual([boot.settings.tax.rate, boot.settings.tax.inclusive, boot.settings.tax.serviceChargeRate], [13, true, 10]);
  assert.equal(boot.settings.card.enabled, false);
  assert.equal(boot.settings.esewa.enabled, true);
  assert.equal(boot.settings.stripe.enabled, false, 'Stripe stays off until a key is saved');
  const special = (await ok('GET', '/api/items')).find((i) => i.name === 'House special');
  assert.equal(special.price, 45000);
});

test('welcome wizard: an existing POS with products is never asked', async () => {
  const { setGroup } = await import('../server/services/settings.js');
  setGroup('onboarding', { done: false });
  assert.equal((await ok('GET', '/api/bootstrap')).welcome, false); // has items → marked done
});

test('open bills are mirrored on the POS and validated', async () => {
  assert.equal(await ok('GET', '/api/drafts'), null);
  const sessions = [{ id: 'a1', label: 'Table 4', at: 1, cart: { lines: [{ key: 'k', itemId: 1, name: 'Tea', unitPrice: 6000, qty: 2 }] } }];
  await ok('PUT', '/api/drafts', { sessions, active: 'a1' });
  const back = await ok('GET', '/api/drafts');
  assert.equal(back.sessions[0].label, 'Table 4');
  assert.equal(back.sessions[0].cart.lines[0].qty, 2);
  assert.equal(back.active, 'a1');
  assert.ok(back.savedAt);
  assert.equal((await call('PUT', '/api/drafts', { sessions: Array.from({ length: 31 }, (_, i) => ({ id: String(i) })) })).status, 400);
  assert.equal((await call('PUT', '/api/drafts', { sessions: [{ id: 'x', cart: { notes: 'x'.repeat(300_000) } }] })).status, 400);
  // With "require the PIN to open the POS" on, open bills need the till session like every other till call.
  const { setGroup } = await import('../server/services/settings.js');
  setGroup('security', { lockScreen: true });
  const anon = await fetch(`${B}/api/drafts`, { headers: { 'X-POS-Client': '1' } });
  setGroup('security', { lockScreen: false });
  assert.equal(anon.status, 401);
  // Writes without the browser's CSRF header are refused.
  const forged = await fetch(`${B}/api/drafts`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: COOKIE }, body: JSON.stringify({ sessions: [] }) });
  assert.equal(forged.status, 403);
});

test('built-in guide renders the user guide safely', async () => {
  const { renderMarkdown } = await import('../server/util/markdown.js');
  const html = renderMarkdown('# Hi <b>x</b>\n\n| A | B |\n|---|---|\n| **1** | [x](#a) |\n\n- one\n- [bad](javascript:alert(1))\n\n> note');
  assert.match(html, /<h1 id="hi-x">Hi &lt;b&gt;x&lt;\/b&gt;<\/h1>/);
  assert.match(html, /<td><strong>1<\/strong><\/td><td><a href="#a">x<\/a><\/td>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<blockquote>note<\/blockquote>/);
  const page = await fetch(`${B}/guide`);
  assert.equal(page.status, 200);
  const text = await page.text();
  assert.match(text, /id="6-a-normal-day"/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});

test('backups: copy to a USB/folder, reminder, and refuse the POS folder itself', async () => {
  const before = await ok('GET', '/api/backups');
  assert.equal(before.reminder.days, null); // never copied off this computer
  assert.ok(Array.isArray(await ok('GET', '/api/backups/drives')));
  const r = await ok('POST', '/api/backups/copy', { folder: outside });
  assert.ok(fs.existsSync(path.join(r.folder, r.name)));
  assert.equal(r.folder, path.join(fs.realpathSync(outside), 'FreeAIPOS-backups'));
  const after = await ok('GET', '/api/backups');
  assert.equal(after.reminder.due, false);
  assert.equal(after.reminder.days, 0);
  assert.equal((await call('POST', '/api/backups/copy', { folder: dir })).status, 400);
  assert.equal((await call('POST', '/api/backups/copy', { folder: 'relative/path' })).status, 400);
  assert.equal((await call('POST', '/api/backups/copy', { folder: path.join(outside, 'not-plugged-in') })).status, 400);
});

test('connectors: "proven" only after a real verified payment', async () => {
  assert.deepEqual(await ok('GET', '/api/connectors/proven'), {});
  const tea = (await ok('GET', '/api/items'))[0];
  const s = await ok('POST', '/api/sales', { lines: [{ itemId: tea.id, qty: 1 }] });
  await ok('POST', `/api/sales/${s.id}/payments`, { method: 'cash', tendered: 100000 });
  const p = await ok('GET', '/api/connectors/proven');
  assert.ok(p.cash);
  assert.equal(p.esewa, undefined);
});

test('start with computer: writes and removes one file in the user startup folder', async () => {
  assert.equal((await ok('GET', '/api/system/autostart')).enabled, false);
  const on = await ok('PUT', '/api/system/autostart', { enabled: true });
  assert.equal(on.enabled, true);
  const file = fs.readdirSync(process.env.POS_AUTOSTART_DIR)[0];
  const body = fs.readFileSync(path.join(process.env.POS_AUTOSTART_DIR, file), 'utf8');
  assert.match(body, /desktop\.mjs/);
  assert.match(body, /--background/);
  assert.equal((await ok('PUT', '/api/system/autostart', { enabled: false })).enabled, false);
  assert.equal(fs.readdirSync(process.env.POS_AUTOSTART_DIR).length, 0);
});

test('update checks are off by default and only accept an HTTPS address', async () => {
  const u = await ok('GET', '/api/updates');
  assert.equal(u.check.autoCheck, false);
  assert.equal(u.downloaded, null);
  assert.equal((await call('POST', '/api/updates/check')).status, 400);
  await ok('PUT', '/api/settings/updates', { values: { manifestUrl: 'http://example.com/latest.json' } });
  assert.equal((await call('POST', '/api/updates/check')).status, 400);
  assert.equal((await call('POST', '/api/updates/install-downloaded')).status, 400);
  const { allowedDestinations } = await import('../server/security/egress.js');
  assert.ok(!allowedDestinations().some((d) => d.connector === 'updates'), 'not allowed while checks are off');
  await ok('PUT', '/api/settings/updates', { values: { autoCheck: true, manifestUrl: 'https://updates.example.com/latest.json' } });
  assert.ok(allowedDestinations().some((d) => d.connector === 'updates' && d.host === 'updates.example.com'));
});

test('touch mode is a till setting', async () => {
  await ok('PUT', '/api/settings/ui', { values: { touchMode: true } });
  const { tillSettings } = await import('../server/services/settings.js');
  assert.equal(tillSettings().ui.touchMode, true);
  void db;
});
