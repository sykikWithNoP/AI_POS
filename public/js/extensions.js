// Extension runtime: owner-written (or AI-generated, owner-reviewed) JavaScript with a small `pos` API.
// Extensions run with the dashboard's privileges, so only enable code you have read.
import { api } from './api.js';
import { dispatch, getState } from './store.js';
import { toast, promptDialog, money, toMinor, toMajor } from './ui.js';

const handlers = new Map();      // event -> [{ext, fn}]
const discountRules = [];        // {ext, label, fn}
const buttons = [];              // {ext, label, icon, onClick}
const loaded = [];               // {id, name, error?}

export function emitExt(event, payload) {
  for (const { ext, fn } of handlers.get(event) || []) {
    try { fn(payload); } catch (e) {
      if (event === 'sale:before') throw e; // allow blocking checkout
      console.error(`[ext ${ext}]`, e); toast(`Extension "${ext}" error: ${e.message}`, 'error');
    }
  }
}

/** Cart in major units, the shape extensions see. */
export function cartForExtensions(cart = getState().cart) {
  const lines = cart.lines.map((l) => ({ itemId: l.itemId, name: l.name, category: l.category, qty: l.qty, unitPrice: toMajor(l.unitPrice), total: toMajor(l.unitPrice * l.qty) }));
  return { lines, subtotal: lines.reduce((a, l) => a + l.total, 0), customer: { ...cart.customer } };
}

/** Evaluate all discount rules -> [{label, amount(minor)}]. */
export function ruleDiscounts(cart) {
  const view = cartForExtensions(cart);
  const out = [];
  for (const r of discountRules) {
    try {
      const amt = Number(r.fn(view)) || 0;
      if (amt > 0) out.push({ label: r.label, amount: toMinor(amt) });
    } catch (e) { console.error(`[ext ${r.ext}] rule`, e); }
  }
  return out;
}

export const extensionButtons = () => buttons;
export const loadedExtensions = () => loaded;

function makeApi(ext) {
  const key = (k) => `pos.ext.${ext.id}.${k}`;
  return Object.freeze({
    on: (event, fn) => { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push({ ext: ext.name, fn }); },
    addDiscountRule: (label, fn) => discountRules.push({ ext: ext.name, label: String(label), fn }),
    addButton: ({ label, icon, onClick }) => buttons.push({ ext: ext.name, label: String(label), icon, onClick }),
    addCustomItem: ({ name, price, qty = 1, taxRate = null }) => dispatch({ type: 'cart/add', item: { id: null, name, price: toMinor(price), tax_rate: taxRate, category: 'Custom' }, qty }),
    toast: (m, level) => toast(String(m), level),
    prompt: (q, d) => promptDialog(String(q), d ?? '', { title: ext.name }),
    api: (path, opts = {}) => api(path, opts),
    storage: {
      get: (k) => { try { return JSON.parse(localStorage.getItem(key(k)) ?? 'null'); } catch { return null; } },
      set: (k, v) => { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch { /* ignore */ } },
    },
    money: (major) => money(toMinor(major)),
    now: () => new Date(),
  });
}

export function loadExtensions(list) {
  for (const ext of list) {
    try {
      // eslint-disable-next-line no-new-func
      new Function('pos', `"use strict";\n${ext.code}`)(makeApi(ext));
      loaded.push({ id: ext.id, name: ext.name });
    } catch (e) {
      loaded.push({ id: ext.id, name: ext.name, error: e.message });
      console.error(`[ext ${ext.name}] failed to load`, e);
      toast(`Extension "${ext.name}" failed to load: ${e.message}`, 'error', 6000);
    }
  }
}
