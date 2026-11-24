// Open bills (POS sessions) mirrored from the browser. They are drafts only: nothing here is a sale,
// and every price is re-checked by the server when a draft is finally charged.
import { db } from '../db.js';
import { badRequest } from '../lib.js';

const MAX_BYTES = 256 * 1024;

export function getDrafts() {
  const row = db.prepare("SELECT data, updated_at FROM drafts WHERE id = 'sessions'").get();
  if (!row) return null;
  try { return { ...JSON.parse(row.data), savedAt: row.updated_at }; } catch { return null; }
}

export function saveDrafts(body) {
  const sessions = body?.sessions;
  if (!Array.isArray(sessions) || sessions.length > 30) throw badRequest('Expected up to 30 open bills');
  const clean = sessions.map((x) => ({
    id: String(x.id).slice(0, 20), label: String(x.label || 'Bill').slice(0, 24), at: Number(x.at) || Date.now(),
    cart: x.cart && typeof x.cart === 'object' ? x.cart : {},
  }));
  const data = JSON.stringify({ sessions: clean, active: String(body.active || '').slice(0, 20) });
  if (data.length > MAX_BYTES) throw badRequest('Open bills are too large to save');
  db.prepare(`INSERT INTO drafts (id, data) VALUES ('sessions', ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(data);
  return { ok: true };
}
