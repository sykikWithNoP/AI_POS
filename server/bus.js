// One-way event flow: services emit() -> subscribers (SSE clients, notification log,
// outbound webhooks, Telegram, Google Calendar). Subscribers never call back into services.
import { EventEmitter } from 'node:events';
import { db } from './db.js';
import { log } from './lib.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function emit(type, payload = {}) {
  emitter.emit('event', { type, payload, at: new Date().toISOString() });
}

export function subscribe(fn) {
  const safe = async (evt) => {
    try { await fn(evt); } catch (e) { log.error('subscriber failed', { type: evt.type, err: e.message }); }
  };
  emitter.on('event', safe);
  return () => emitter.off('event', safe);
}

// --- Notification log (bell icon) ---
const insertNote = db.prepare('INSERT INTO notifications (type, level, title, body, data) VALUES (?, ?, ?, ?, ?)');

export function notify({ type, level = 'info', title, body = '', data = null }) {
  const r = insertNote.run(type, level, title, body, data ? JSON.stringify(data) : null);
  emit('notification', { id: Number(r.lastInsertRowid), type, level, title, body, data });
}

export function listNotifications(limit = 50) {
  return db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?').all(limit)
    .map((n) => ({ ...n, data: n.data ? JSON.parse(n.data) : null, read: !!n.read }));
}
export const markAllRead = () => db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();

// --- Server-Sent Events hub ---
const clients = new Set();
export function sseHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}
subscribe((evt) => {
  const line = `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
  for (const c of clients) c.write(line);
});
