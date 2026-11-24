// Extension host. Extensions run in a sandboxed iframe (/sandbox.html): opaque origin, no network,
// no cookies or storage, no access to this page. They reach the POS only through the messages below,
// and every message is validated here. The server still re-checks all prices, discounts and rules.
import { get } from './api.js';
import { dispatch, getState } from './store.js';
import { toast, promptDialog, toMinor, toMajor } from './ui.js';

let frame = null;
let ready = null;
let loadedSignal = null;
let seq = 0;
const pending = new Map();                 // reqId -> resolve
const buttons = [];                        // {id, label, icon, ext}
const loaded = [];                         // {id, name, error?}
let rulesCache = { sig: '', discounts: [] };
let onRulesChanged = () => {};

const API_ALLOW = [/^\/api\/items(\?[\w=&%.-]*)?$/, /^\/api\/customers(\?[\w=&%.-]*)?$/, /^\/api\/overview(\?[\w=&%.-]*)?$/, /^\/api\/sales(\?[\w=&%.:-]*)?$/, /^\/api\/categories$/];
const STORE_KEY = (ext, key) => `pos.ext.${Number(ext)}.${String(key).replace(/[^\w.-]/g, '_')}`;

// Simple flood control: an extension can't spam the host.
let budget = 100;
setInterval(() => { budget = 100; }, 1000);

function post(msg) { frame?.contentWindow?.postMessage(msg, '*'); }
function request(msg) {
  return new Promise((resolve) => {
    const reqId = ++seq;
    const t = setTimeout(() => { pending.delete(reqId); resolve(null); }, 1500); // a hung extension can't block the POS
    pending.set(reqId, (v) => { clearTimeout(t); resolve(v); });
    post({ ...msg, reqId });
  });
}

async function onMessage(e) {
  if (!frame || e.source !== frame.contentWindow) return; // only our sandbox
  if (--budget < 0) return;
  const m = e.data || {};
  const reply = (value, error) => post({ type: 'reply', reqId: m.reqId, value, error });
  switch (m.type) {
    case 'ready': ready?.(); break;
    case 'loaded':
      loaded.splice(0, loaded.length, ...(m.results || []).map((r) => ({ id: Number(r.id), name: String(r.name), error: r.error ? String(r.error) : undefined })));
      for (const r of loaded) if (r.error) toast(`Extension "${r.name}" failed to load: ${r.error}`, 'error', 6000);
      loadedSignal?.();
      break;
    case 'rules-result': case 'before-result': {
      const done = pending.get(m.reqId);
      if (done) { pending.delete(m.reqId); done(m); }
      break;
    }
    case 'button-add':
      if (buttons.length < 12) buttons.push({ id: String(m.id), label: String(m.label).slice(0, 40), icon: String(m.icon || '').slice(0, 4), ext: String(m.ext).slice(0, 60) });
      break;
    case 'toast': toast(String(m.msg).slice(0, 200), ['info', 'success', 'warn', 'error'].includes(m.level) ? m.level : 'info'); break;
    case 'custom-item': {
      const it = m.item || {};
      const price = Number(it.price), qty = Number(it.qty) || 1;
      if (!it.name || !Number.isFinite(price) || price <= 0 || price > 1e7 || qty <= 0 || qty > 1000) return;
      dispatch({ type: 'cart/add', item: { id: null, name: String(it.name).slice(0, 80), price: toMinor(price), tax_rate: it.taxRate == null ? null : Math.min(100, Math.max(0, Number(it.taxRate) || 0)), category: 'Custom' }, qty });
      break;
    }
    case 'prompt': reply(await promptDialog(String(m.q), String(m.d ?? ''), { title: `Extension: ${String(m.ext).slice(0, 40)}` })); break;
    case 'api': {
      const path = String(m.path);
      if (!API_ALLOW.some((re) => re.test(path))) return reply(null, 'Not allowed: extensions can only read items, customers, sales and overview');
      try { reply(await get(path)); } catch (err) { reply(null, err.message); }
      break;
    }
    case 'storage-get': try { reply(JSON.parse(localStorage.getItem(STORE_KEY(m.ext, m.key)) ?? 'null')); } catch { reply(null); } break;
    case 'storage-set': try { const v = String(m.value); if (v.length <= 20000) localStorage.setItem(STORE_KEY(m.ext, m.key), v); } catch { /* ignore */ } break;
    default:
  }
}

let listening = false;
/** Tear down the sandbox and load the current list again (used after toggling/saving extensions). */
export async function reloadExtensions(list) {
  frame?.remove(); frame = null;
  buttons.splice(0); loaded.splice(0); pending.clear();
  rulesCache = { sig: '', discounts: [] };
  await loadExtensions(list);
  onRulesChanged();
  window.dispatchEvent(new CustomEvent('pos:extensions-reloaded'));
}

export async function loadExtensions(list) {
  if (!list.length) return;
  if (!listening) { window.addEventListener('message', onMessage); listening = true; }
  frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts'); // no allow-same-origin: opaque origin
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  frame.src = '/sandbox.html';
  const isReady = new Promise((r) => { ready = r; });
  document.body.append(frame);
  await isReady;
  const b = getState().boot.settings.business;
  const done = new Promise((r) => { loadedSignal = r; });
  post({ type: 'load', exts: list.map((x) => ({ id: x.id, name: x.name, code: x.code })), money: { symbol: b.currencySymbol, locale: b.locale } });
  await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
}

/** Fire-and-forget events (cart:change, sale:complete, payment:verified, view:change). Payloads are copied. */
export function emitExt(event, payload) {
  if (!frame) return;
  try { post({ type: 'event', event, payload: JSON.parse(JSON.stringify(payload ?? null)) }); } catch { /* unclonable */ }
}

/** Ask extensions whether checkout may proceed. Resolves to an error message or null. */
export async function checkBeforeSale(draft) {
  if (!frame) return null;
  const r = await request({ type: 'before', payload: JSON.parse(JSON.stringify(draft)) });
  return r?.error || null;
}

/** Cart in major units: the only view of the cart extensions get. */
export function cartForExtensions(cart = getState().cart) {
  const lines = cart.lines.map((l) => ({ itemId: l.itemId, name: l.name, category: l.category, qty: l.qty, unitPrice: toMajor(l.unitPrice), total: toMajor(l.unitPrice * l.qty) }));
  return { lines, subtotal: lines.reduce((a, l) => a + l.total, 0), customer: { name: cart.customer?.name || '', pan: cart.customer?.pan || '', phone: cart.customer?.phone || '', member: cart.customer?.membership?.name || null } };
}

const sigOf = (cart) => JSON.stringify([cart.lines.map((l) => [l.itemId, l.name, l.qty, l.unitPrice]), cart.customer?.id || null]);

/** Cached discount-rule results for this cart (minor units); refreshes asynchronously when the cart changes. */
export function ruleDiscounts(cart) {
  if (!frame) return [];
  const sig = sigOf(cart);
  if (sig !== rulesCache.sig) { rulesCache = { sig, discounts: rulesCache.discounts, stale: true }; refreshRules(cart, sig); }
  return rulesCache.discounts;
}

async function refreshRules(cart, sig) {
  const view = cartForExtensions(cart);
  const r = await request({ type: 'rules', cart: view });
  if (sig !== rulesCache.sig) return;
  const cap = toMinor(view.subtotal);
  const discounts = (r?.discounts || []).slice(0, 10)
    .map((d) => ({ label: String(d.label).slice(0, 60), amount: Math.min(cap, toMinor(Number(d.amount) || 0)) }))
    .filter((d) => d.amount > 0);
  rulesCache = { sig, discounts };
  onRulesChanged();
}

/** Make sure rule results are current before charging. */
export async function settleRules(cart) {
  if (!frame) return [];
  const sig = sigOf(cart);
  if (rulesCache.sig !== sig || rulesCache.stale) await refreshRules(cart, (rulesCache = { sig, discounts: [] }).sig);
  return rulesCache.discounts;
}

export const onRulesUpdate = (fn) => { onRulesChanged = fn; };
export const extensionButtons = () => buttons;
export const clickExtensionButton = (id) => post({ type: 'button', id });
export const loadedExtensions = () => loaded;
