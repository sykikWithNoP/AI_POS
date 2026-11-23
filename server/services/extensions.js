// User-built extensions: JavaScript the shop owner writes (or generates with AI) and enables.
// They run in the owner's own browser with a documented `pos` API (see public/js/extensions.js).
import { db, nowIso } from '../db.js';
import { badRequest, notFound } from '../lib.js';
import { scanExtension } from '../security/guard.js';
import { append as appendLedger } from '../security/ledger.js';
import crypto from 'node:crypto';

const out = (r) => r && ({ ...r, enabled: !!r.enabled });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Only code whose hash matches the signed ledger entry may run (detects edits made directly in the DB). */
export function verifiedEnabledExtensions() {
  const signed = new Map();
  for (const r of db.prepare("SELECT ref, payload FROM ledger WHERE kind = 'extension.saved' ORDER BY id").all()) signed.set(r.ref, JSON.parse(r.payload).codeSha256);
  return listExtensions().filter((e) => e.enabled && signed.get(String(e.id)) === sha(e.code));
}

export const listExtensions = () => db.prepare('SELECT * FROM extensions ORDER BY id').all().map(out);

export function getExtension(id) {
  const r = db.prepare('SELECT * FROM extensions WHERE id = ?').get(Number(id));
  if (!r) throw notFound('Extension');
  return out(r);
}

function clean(input) {
  const name = String(input.name || '').trim();
  if (!name) throw badRequest('Name is required');
  const code = String(input.code || '');
  if (!code.trim()) throw badRequest('Code is required');
  if (code.length > 50_000) throw badRequest('Code is too large');
  scanExtension(code);
  return { name: name.slice(0, 80), description: String(input.description || '').slice(0, 500), code };
}

export function createExtension(input) {
  const d = clean(input);
  const r = db.prepare('INSERT INTO extensions (name, description, code, enabled) VALUES (?, ?, ?, ?)').run(d.name, d.description, d.code, input.enabled ? 1 : 0);
  appendLedger('extension.saved', r.lastInsertRowid, { name: d.name, codeSha256: sha(d.code), enabled: !!input.enabled });
  return getExtension(r.lastInsertRowid);
}

export function updateExtension(id, input) {
  const cur = getExtension(id);
  const d = clean({ ...cur, ...input });
  const enabled = 'enabled' in input ? (input.enabled ? 1 : 0) : (cur.enabled ? 1 : 0);
  db.prepare('UPDATE extensions SET name = ?, description = ?, code = ?, enabled = ?, updated_at = ? WHERE id = ?').run(d.name, d.description, d.code, enabled, nowIso(), Number(id));
  appendLedger('extension.saved', id, { name: d.name, codeSha256: sha(d.code), enabled: !!enabled });
  return getExtension(id);
}

export function deleteExtension(id) {
  getExtension(id);
  db.prepare('DELETE FROM extensions WHERE id = ?').run(Number(id));
  return { deleted: true };
}
