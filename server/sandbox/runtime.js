// Runs INSIDE the sandboxed iframe (opaque origin, CSP: no network). Extensions see only `pos`.
(() => {
  'use strict';
  const host = window.parent;
  const send = (m) => host.postMessage(m, '*'); // parent is the only possible receiver; data is non-sensitive
  let seq = 0;
  const waiting = new Map();
  const ask = (m) => new Promise((resolve, reject) => { const reqId = ++seq; waiting.set(reqId, { resolve, reject }); send({ ...m, reqId }); });
  const handlers = new Map(); // event -> [{ext, fn}]
  const rules = [];            // {ext, label, fn}
  const buttons = new Map();   // id -> {ext, onClick}
  let money = (v) => String(v);

  function makeApi(ext) {
    return Object.freeze({
      on: (event, fn) => { if (typeof fn !== 'function') return; if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push({ ext, fn }); },
      addDiscountRule: (label, fn) => { if (typeof fn === 'function') rules.push({ ext, label: String(label).slice(0, 60), fn }); },
      addButton: ({ label, icon, onClick }) => { const id = `${ext.id}:${buttons.size}`; buttons.set(id, { ext, onClick }); send({ type: 'button-add', id, label: String(label).slice(0, 40), icon: icon ? String(icon).slice(0, 4) : '', ext: ext.name }); },
      addCustomItem: ({ name, price, qty = 1, taxRate = null }) => send({ type: 'custom-item', item: { name: String(name).slice(0, 80), price: Number(price), qty: Number(qty), taxRate } }),
      toast: (msg, level) => send({ type: 'toast', msg: String(msg).slice(0, 200), level }),
      prompt: (q, d) => ask({ type: 'prompt', q: String(q).slice(0, 200), d: d == null ? '' : String(d).slice(0, 200), ext: ext.name }),
      api: (path) => ask({ type: 'api', path: String(path) }),
      storage: {
        get: (key) => ask({ type: 'storage-get', ext: ext.id, key: String(key).slice(0, 60) }),
        set: (key, value) => send({ type: 'storage-set', ext: ext.id, key: String(key).slice(0, 60), value: JSON.stringify(value ?? null).slice(0, 20000) }),
      },
      money: (major) => money(major),
      now: () => new Date(),
    });
  }

  function run(event, payload) {
    for (const { ext, fn } of handlers.get(event) || []) {
      try { fn(payload); } catch (e) {
        if (event === 'sale:before') throw e;
        send({ type: 'toast', msg: `Extension "${ext.name}": ${e.message}`, level: 'error' });
      }
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== host) return;
    const m = e.data || {};
    switch (m.type) {
      case 'load': {
        const { symbol, locale } = m.money || {};
        money = (v) => `${symbol || ''} ${Number(v).toLocaleString(locale || 'en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const results = [];
        for (const ext of m.exts || []) {
          try { new Function('pos', `"use strict";\n${ext.code}`)(makeApi({ id: ext.id, name: ext.name })); results.push({ id: ext.id, name: ext.name }); }
          catch (err) { results.push({ id: ext.id, name: ext.name, error: String(err.message).slice(0, 200) }); }
        }
        send({ type: 'loaded', results });
        break;
      }
      case 'event': run(m.event, m.payload); break;
      case 'before': {
        let error = null;
        try { run('sale:before', m.payload); } catch (err) { error = String(err?.message || err).slice(0, 200); }
        send({ type: 'before-result', reqId: m.reqId, error });
        break;
      }
      case 'rules': {
        const out = [];
        for (const r of rules) {
          try { const a = Number(r.fn(m.cart)); if (Number.isFinite(a) && a > 0) out.push({ label: r.label, amount: a }); } catch { /* bad rule: ignored */ }
        }
        send({ type: 'rules-result', reqId: m.reqId, discounts: out });
        break;
      }
      case 'button': { const b = buttons.get(m.id); try { b?.onClick?.(); } catch (err) { send({ type: 'toast', msg: err.message, level: 'error' }); } break; }
      case 'reply': { const w = waiting.get(m.reqId); if (w) { waiting.delete(m.reqId); m.error ? w.reject(new Error(m.error)) : w.resolve(m.value); } break; }
      default:
    }
  });
  send({ type: 'ready' });
})();
