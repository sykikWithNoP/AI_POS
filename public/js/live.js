// Server -> browser event stream (SSE). The browser only listens; actions go through api.js.
import { dispatch } from './store.js';
import { toast, chime } from './ui.js';
import { emitExt } from './extensions.js';

const listeners = new Set();
let es;

export function onServerEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const TYPES = ['notification', 'sale.created', 'sale.paid', 'sale.updated', 'sale.void', 'payment.pending', 'payment.verified', 'payment.failed', 'payment.cancelled', 'item.created', 'item.updated', 'item.deleted', 'sale.postponed', 'refund.created', 'shift.opened', 'shift.closed', 'membership.activated'];

export function connectLive() {
  es?.close();
  es = new EventSource('/api/events');
  for (const t of TYPES) {
    es.addEventListener(t, (msg) => {
      const evt = JSON.parse(msg.data);
      if (evt.type === 'notification') {
        const n = { ...evt.payload, read: false, created_at: evt.at };
        dispatch({ type: 'notification/add', n });
        if (n.type !== 'sale.paid') { toast(n.title + (n.body ? ` — ${n.body}` : ''), n.level === 'error' ? 'error' : n.level === 'success' ? 'success' : 'info', 6000); }
        if (n.type === 'payment.verified') chime('ok');
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(n.title, { body: n.body || '' });
      }
      if (evt.type === 'payment.verified') emitExt('payment:verified', evt.payload.payment);
      for (const l of listeners) { try { l(evt); } catch (e) { console.error(e); } }
    });
  }
}
