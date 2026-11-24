// The phone stand-ins must behave exactly like Node's real modules for what the POS uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import initSqlJs from 'sql.js';
import * as phone from '../engine/shims/crypto.js';
import { setSqlModule } from '../engine/runtime.js';
import fs from '../engine/shims/fs.js';
import { DatabaseSync } from '../engine/shims/sqlite.js';
import express, { createExchange } from '../engine/shims/express.js';

test('crypto: hashes, HMAC and scrypt match Node exactly', () => {
  assert.equal(phone.createHash('sha256').update('abc').digest('hex'), nodeCrypto.createHash('sha256').update('abc').digest('hex'));
  assert.equal(phone.createHmac('sha256', 'key').update('a').update('b').digest('base64'), nodeCrypto.createHmac('sha256', 'key').update('ab').digest('base64'));
  const salt = Buffer.from('0123456789abcdef');
  const o = { N: 1024, r: 8, p: 1 };
  assert.equal(phone.scryptSync('1234', salt, 32, o).toString('hex'), nodeCrypto.scryptSync('1234', salt, 32, o).toString('hex'));
  assert.equal(phone.randomBytes(40).length, 40);
  assert.equal(phone.timingSafeEqual(Buffer.from('ab'), Buffer.from('ab')), true);
});

test('crypto: AES-256-GCM is interchangeable with Node (both directions)', () => {
  const key = nodeCrypto.randomBytes(32), iv = nodeCrypto.randomBytes(12), msg = Buffer.from('secret key for eSewa');
  const c = phone.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(msg), c.final()]);
  const d = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(c.getAuthTag());
  assert.deepEqual(Buffer.concat([d.update(ct), d.final()]), msg);
  const c2 = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const ct2 = Buffer.concat([c2.update(msg), c2.final()]);
  const d2 = phone.createDecipheriv('aes-256-gcm', key, iv); d2.setAuthTag(c2.getAuthTag());
  assert.deepEqual(Buffer.concat([d2.update(ct2), d2.final()]), msg);
  const bad = phone.createDecipheriv('aes-256-gcm', key, iv); bad.setAuthTag(Buffer.alloc(16));
  bad.update(ct2);
  assert.throws(() => bad.final(), /authenticate/);
});

test('crypto: Ed25519 signatures from Node keys verify (update packages)', () => {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const data = Buffer.from('manifest');
  const sig = nodeCrypto.sign(null, data, privateKey);
  assert.equal(phone.verify(null, data, phone.createPublicKey(pem), sig), true);
  assert.equal(phone.verify(null, Buffer.from('tampered'), phone.createPublicKey(pem), sig), false);
});

test('sqlite: DatabaseSync API (named/positional params, run/get/all, VACUUM INTO)', async () => {
  setSqlModule(await initSqlJs());
  globalThis.process.env.DB_FILE = '/data/test.db';
  const db = new DatabaseSync('/data/test.db');
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER)');
  const ins = db.prepare('INSERT INTO t (name, n) VALUES (?, ?)');
  assert.deepEqual(ins.run('a', 1), { changes: 1, lastInsertRowid: 1 });
  assert.equal(ins.run('b', 2).lastInsertRowid, 2);
  assert.deepEqual(db.prepare('SELECT name FROM t WHERE n = :n').get({ n: 2 }), { name: 'b' });
  assert.equal(db.prepare('SELECT * FROM t WHERE id = 99').get(), undefined);
  assert.equal(db.prepare('SELECT * FROM t ORDER BY id').all().length, 2);
  fs.mkdirSync('/data/backups', { recursive: true });
  db.exec("VACUUM INTO '/data/backups/copy.db'");
  const copy = new DatabaseSync('/data/backups/copy.db');
  assert.equal(copy.prepare('SELECT COUNT(*) AS c FROM t').get().c, 2);
});

test('express: routing, params, mounting, JSON bodies, errors, cookies', async () => {
  const app = express();
  const api = express.Router();
  api.get('/items/:id', (req, res) => res.json({ id: req.params.id, q: req.query.q }));
  api.post('/echo', (req, res) => res.status(201).append('Set-Cookie', 'a=1; Path=/').json(req.body));
  api.get('/boom', () => { throw Object.assign(new Error('nope'), { status: 409 }); });
  app.use(express.json());
  app.use('/api', api);
  app.use((err, req, res, next) => { void next; res.status(err.status).json({ message: err.message }); });
  const call = async (method, url, body) => {
    const x = createExchange({ method, url, headers: { 'content-type': 'application/json' }, body: body ? new TextEncoder().encode(JSON.stringify(body)) : null });
    app.handle(x.req, x.res, () => x.res.status(404).json({}));
    await x.done;
    return { status: x.res.statusCode, json: JSON.parse(x.res.chunks.join('')), headers: x.res.headers };
  };
  assert.deepEqual((await call('GET', '/api/items/7?q=tea')).json, { id: '7', q: 'tea' });
  const e = await call('POST', '/api/echo', { a: 1 });
  assert.equal(e.status, 201); assert.deepEqual(e.json, { a: 1 }); assert.deepEqual(e.headers['set-cookie'], ['a=1; Path=/']);
  assert.equal((await call('GET', '/api/boom')).status, 409);
  assert.equal((await call('GET', '/nothing')).status, 404);
});
