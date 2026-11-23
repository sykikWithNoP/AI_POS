// Outbound webhooks: POS events -> your URLs, signed with HMAC-SHA256 (X-POS-Signature).
import { db } from '../db.js';
import { badRequest, notFound, randomToken, hmacHex, log } from '../lib.js';

export const EVENTS = ['sale.created', 'sale.paid', 'sale.void', 'payment.verified', 'payment.failed', 'item.created', 'item.updated', 'item.deleted'];

export function listHooks() {
  return db.prepare('SELECT id, url, events, active, last_status, created_at FROM webhooks_out ORDER BY id DESC').all()
    .map((h) => ({ ...h, events: h.events.split(','), active: !!h.active }));
}

export function createHook({ url, events }) {
  let u;
  try { u = new URL(url); } catch { throw badRequest('Invalid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw badRequest('URL must be http(s)');
  const ev = (events || []).filter((e) => EVENTS.includes(e));
  if (!ev.length) throw badRequest('Pick at least one event');
  const secret = `whsec_${randomToken(24)}`;
  const r = db.prepare('INSERT INTO webhooks_out (url, events, secret) VALUES (?, ?, ?)').run(u.toString(), ev.join(','), secret);
  return { id: Number(r.lastInsertRowid), url: u.toString(), events: ev, secret };
}

export function deleteHook(id) {
  const r = db.prepare('DELETE FROM webhooks_out WHERE id = ?').run(Number(id));
  if (!r.changes) throw notFound('Webhook');
  return { deleted: true };
}

export async function dispatch(evt) {
  if (!EVENTS.includes(evt.type)) return;
  const hooks = db.prepare('SELECT * FROM webhooks_out WHERE active = 1').all().filter((h) => h.events.split(',').includes(evt.type));
  for (const h of hooks) {
    const body = JSON.stringify({ id: randomToken(8), type: evt.type, created_at: evt.at, data: evt.payload });
    let status;
    try {
      const res = await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-POS-Event': evt.type, 'X-POS-Signature': hmacHex(h.secret, body) }, body, signal: AbortSignal.timeout(8000) });
      status = `${res.status} @ ${evt.at}`;
    } catch (e) {
      status = `error: ${e.message}`;
      log.warn('webhook delivery failed', { hook: h.id, err: e.message });
    }
    db.prepare('UPDATE webhooks_out SET last_status = ? WHERE id = ?').run(status, h.id);
  }
}
