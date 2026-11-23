// POS API keys for external apps. Only a SHA-256 hash is stored; the key is shown once.
import { db, nowIso } from '../db.js';
import { badRequest, notFound, randomToken, sha256 } from '../lib.js';

export const SCOPES = ['read', 'write'];

export function createKey({ name, scopes }) {
  const n = String(name || '').trim();
  if (!n) throw badRequest('Name is required');
  const sc = (Array.isArray(scopes) ? scopes : ['read']).filter((s) => SCOPES.includes(s));
  if (!sc.length) throw badRequest('Pick at least one scope');
  const key = `pos_${randomToken(24)}`;
  const r = db.prepare('INSERT INTO api_keys (name, prefix, hash, scopes) VALUES (?, ?, ?, ?)').run(n.slice(0, 60), key.slice(0, 10), sha256(key), sc.join(','));
  return { id: Number(r.lastInsertRowid), name: n, key, scopes: sc };
}

export function listKeys() {
  return db.prepare('SELECT id, name, prefix, scopes, created_at, last_used, revoked FROM api_keys ORDER BY id DESC').all()
    .map((k) => ({ ...k, scopes: k.scopes.split(','), revoked: !!k.revoked }));
}

export function revokeKey(id) {
  const r = db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(Number(id));
  if (!r.changes) throw notFound('API key');
  return { revoked: true };
}

/** Returns { id, scopes } for a valid key, else null. */
export function authenticate(key) {
  if (!key || !key.startsWith('pos_')) return null;
  const row = db.prepare('SELECT id, scopes FROM api_keys WHERE hash = ? AND revoked = 0').get(sha256(key));
  if (!row) return null;
  db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(nowIso(), row.id);
  return { id: row.id, scopes: row.scopes.split(',') };
}
