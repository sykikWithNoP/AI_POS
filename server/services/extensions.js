// User-built extensions: JavaScript the shop owner writes (or generates with AI) and enables.
// They run in the owner's own browser with a documented `pos` API (see public/js/extensions.js).
import { db, nowIso } from '../db.js';
import { badRequest, notFound } from '../lib.js';

const out = (r) => r && ({ ...r, enabled: !!r.enabled });

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
  if (code.length > 100_000) throw badRequest('Code is too large');
  return { name: name.slice(0, 80), description: String(input.description || '').slice(0, 500), code };
}

export function createExtension(input) {
  const d = clean(input);
  const r = db.prepare('INSERT INTO extensions (name, description, code, enabled) VALUES (?, ?, ?, ?)').run(d.name, d.description, d.code, input.enabled ? 1 : 0);
  return getExtension(r.lastInsertRowid);
}

export function updateExtension(id, input) {
  const cur = getExtension(id);
  const d = clean({ ...cur, ...input });
  const enabled = 'enabled' in input ? (input.enabled ? 1 : 0) : (cur.enabled ? 1 : 0);
  db.prepare('UPDATE extensions SET name = ?, description = ?, code = ?, enabled = ?, updated_at = ? WHERE id = ?').run(d.name, d.description, d.code, enabled, nowIso(), Number(id));
  return getExtension(id);
}

export function deleteExtension(id) {
  getExtension(id);
  db.prepare('DELETE FROM extensions WHERE id = ?').run(Number(id));
  return { deleted: true };
}
