import { icon } from './icons.js';
import { getState } from './store.js';
import { formatMoney, toMinor, toMajor } from '/shared/billing.js';

/** Tiny hyperscript: h('div.card#id', { onclick, class, style, ... }, children...) */
export function h(sel, props, ...children) {
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { children.unshift(props); props = {}; }
  const [, tag = 'div', rest = ''] = sel.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export { icon };

export const money = (minor) => {
  const b = getState().boot?.settings?.business;
  return formatMoney(minor || 0, b?.currencySymbol || 'Rs.', b?.locale || 'en-IN');
};
export { toMinor, toMajor };
export const fmtDate = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => (iso ? new Date(iso).toLocaleString(undefined, opts) : '');
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- toasts ----------
let toastRoot;
export function toast(msg, level = 'info', ms = 3500) {
  toastRoot ||= document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
  const t = h(`div.toast.${level}`, icon({ success: 'check', error: 'x', warn: 'bell' }[level] || 'bell', 18), h('span', msg));
  toastRoot.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
export const errorToast = (e) => toast(e?.message || String(e), 'error', 5000);

// ---------- sound ----------
let audioCtx;
export function chime(kind = 'ok') {
  if (getState().boot?.settings?.ui?.sound === false) return;
  try {
    audioCtx ||= new AudioContext();
    const notes = kind === 'ok' ? [880, 1320] : [440, 330];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.12 + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * 0.12); o.stop(audioCtx.currentTime + i * 0.12 + 0.3);
    });
  } catch { /* audio unavailable */ }
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const footer = actions.length ? h('footer.modal-actions', actions.map((a) => h(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}`, { type: 'button', onclick: () => a.onClick?.(close) }, a.label))) : null;
  const box = h(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header.modal-head', h('h3', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div.modal-body', body), footer);
  const overlay = h('div.overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  setTimeout(() => box.querySelector('input,select,textarea,button.primary')?.focus(), 30);
  return { close, box };
}

export function confirmDialog(message, { title = 'Are you sure?', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, body: h('p', message), onClose: () => { if (!done) resolve(false); },
      actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: okLabel, primary: !danger, danger, onClick: (c) => { done = true; resolve(true); c(); } }] });
    return m;
  });
}

export function promptDialog(question, defaultValue = '', { title = 'Input', type = 'text' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.input', { type, value: defaultValue });
    const submit = (c) => { done = true; resolve(input.value); c(); };
    const m = modal({ title, body: h('label.field', h('span', question), input), onClose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'OK', primary: true, onClick: submit }] });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(m.close); });
  });
}

// ---------- form helpers ----------
export function field(label, input, hint) {
  return h('label.field', h('span', label), input, hint ? h('small.hint', hint) : null);
}
export function toggle(name, checked, label) {
  return h('label.toggle', h('input', { type: 'checkbox', name, checked }), h('span.track'), h('span', label));
}
export function formValues(form) {
  const out = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  }
  return out;
}
export function badge(text, kind = '') { return h(`span.badge${kind ? '.' + kind : ''}`, text); }
export function empty(text, iconName = 'box') { return h('div.empty', icon(iconName, 32), h('p', text)); }

/**
 * Picture picker that keeps the picture on this PC: re-encoded to a small PNG/JPEG data URL
 * (strips metadata). The value is in el.dataset.image ('' = none).
 */
export function imageInput(current = '', { max = 512 } = {}) {
  const wrap = h('div.image-input');
  wrap.dataset.image = current || '';
  const prev = h('img', { alt: '', hidden: !current, src: current || undefined });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  const clear = h('button.btn.sm', { type: 'button', hidden: !current, onclick: () => { wrap.dataset.image = ''; prev.hidden = true; clear.hidden = true; file.value = ''; } }, 'Remove');
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      let url = c.toDataURL('image/png');
      if (url.length > 600_000) url = c.toDataURL('image/jpeg', 0.85);
      wrap.dataset.image = url; prev.src = url; prev.hidden = false; clear.hidden = false;
    } catch { toast('Could not read that picture', 'error'); }
  });
  wrap.append(prev, file, clear);
  return wrap;
}
