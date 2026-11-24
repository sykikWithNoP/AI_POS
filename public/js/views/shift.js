// Shift & cash drawer: open with a float, pay in/out, X report, close with a count → Z report.
import { h, icon, money, toast, errorToast, modal, field, fmtDate, badge } from '../ui.js';
import { get, post } from '../api.js';
import { getState, dispatch, subscribe } from '../store.js';

export function shiftChip() {
  const btn = h('button.btn.sm.shift-chip', { onclick: drawerDialog });
  const draw = () => {
    const s = getState().boot.shift;
    btn.replaceChildren(icon('wallet', 16), s ? h('span', 'Shift open ', h('small.muted', `since ${fmtDate(s.opened_at, { timeStyle: 'short' })}`)) : h('span', 'Open shift'));
    btn.classList.toggle('open', !!s);
  };
  draw();
  const unsub = subscribe((st, prev) => { if (!btn.isConnected) return unsub(); if (st.boot.shift !== prev.boot?.shift) draw(); });
  return btn;
}

async function refreshShift() {
  const cur = await get('/api/shifts/current');
  dispatch({ type: 'shift', shift: cur.shift });
  return cur;
}

export async function drawerDialog() {
  const cur = await refreshShift();
  if (!cur.shift) return openDialog();
  const r = cur.report;
  const m = modal({
    title: 'Cash drawer', wide: true,
    body: reportView(r),
    actions: [
      { label: 'Open drawer', onClick: async () => { try { await post('/api/print/drawer'); toast('Drawer opened (logged)', 'success'); } catch (e) { errorToast(e); } } },
      { label: 'Pay in', onClick: () => moveDialog('in', () => { m.close(); drawerDialog(); }) },
      { label: 'Pay out', onClick: () => moveDialog('out', () => { m.close(); drawerDialog(); }) },
      { label: 'Print X report', onClick: () => printReport('X report', r) },
      { label: 'Close shift', primary: true, onClick: (c) => { c(); closeDialog(r); } },
    ],
  });
}

function openDialog() {
  const float = h('input.input.big', { type: 'number', min: 0, step: 'any', value: 0 });
  const who = h('input.input', { placeholder: 'Cashier name (optional)' });
  modal({
    title: 'Open shift', body: h('div.form-grid', h('p.hint', 'Count the cash in the drawer to start. Everything sold, refunded and paid in/out until you close is tracked against this shift.'), field('Opening float (cash in drawer)', float), field('Cashier', who)),
    actions: [{ label: 'Open shift', primary: true, onClick: async (c) => {
      try { await post('/api/shifts/open', { float: float.value, openedBy: who.value }); await refreshShift(); toast('Shift opened', 'success'); c(); } catch (e) { errorToast(e); }
    } }],
  });
}

function moveDialog(kind, done) {
  const amount = h('input.input', { type: 'number', min: 0, step: 'any' });
  const reason = h('input.input', { placeholder: kind === 'out' ? 'e.g. Bought milk, paid supplier' : 'e.g. Added change' });
  modal({
    title: kind === 'in' ? 'Pay in (cash added)' : 'Pay out (cash removed)', body: h('div.form-grid', field('Amount', amount), field('Reason', reason)),
    actions: [{ label: 'Record', primary: true, onClick: async (c) => {
      try { await post('/api/shifts/cash', { kind, amount: amount.value, reason: reason.value }); toast('Recorded', 'success'); c(); done(); } catch (e) { errorToast(e); }
    } }],
  });
}

function closeDialog(r) {
  const counted = h('input.input.big', { type: 'number', min: 0, step: 'any', placeholder: '0.00' });
  const varEl = h('div.change');
  const upd = () => {
    if (counted.value === '') return varEl.replaceChildren(h('span.muted', `Expected ${money(r.cash.expected)}`));
    const v = Math.round(Number(counted.value) * 100) - r.cash.expected;
    varEl.replaceChildren(h('span', `Expected ${money(r.cash.expected)} · Variance `, h(`b.${v === 0 ? 'ok-text' : v > 0 ? 'warn-text' : 'danger-text'}`, `${v > 0 ? '+' : ''}${money(v)}`)));
  };
  counted.addEventListener('input', upd); upd();
  const note = h('input.input', { placeholder: 'Note (optional)' });
  modal({
    title: 'Close shift', body: h('div.form-grid', h('p.hint', 'Count all cash in the drawer, including the float.'), field('Counted cash', counted), varEl, field('Note', note)),
    actions: [{ label: 'Close & print Z report', primary: true, onClick: async (c) => {
      try {
        const z = await post('/api/shifts/close', { counted: counted.value, note: note.value });
        dispatch({ type: 'shift', shift: null });
        c(); printReport('Z report', z);
      } catch (e) { errorToast(e); }
    } }],
  });
}

function reportView(r) {
  const row = (l, v, cls = '') => h('li', h('span', l), h(`b${cls}`, v));
  return h('div.z',
    h('div.meta-grid', h('div', h('small', 'Opened'), fmtDate(r.openedAt)), h('div', h('small', 'Cashier'), r.openedBy || '—'), h('div', h('small', 'Bills'), r.sales.bills), h('div', h('small', 'Gross sales'), money(r.sales.gross))),
    h('div.z-cols',
      h('div', h('h4', 'Cash drawer'), h('ul.rank', row('Opening float', money(r.cash.float)), row('Cash sales', money(r.cash.sales)), row('Cash refunds', `−${money(r.cash.refunds)}`), row('Pay in', money(r.cash.payIn)), row('Pay out', `−${money(r.cash.payOut)}`), row('Expected in drawer', money(r.cash.expected), '.ok-text'),
        r.counted !== null && r.counted !== undefined ? row('Counted', money(r.counted)) : null, r.variance !== null && r.variance !== undefined ? row('Variance', money(r.variance), r.variance === 0 ? '.ok-text' : '.danger-text') : null)),
      h('div', h('h4', 'By payment method'), r.methods.length ? h('ul.rank', r.methods.map((x) => row(`${x.method} (${x.n})`, money(x.amount)))) : h('p.muted', 'No payments yet'),
        h('h4', 'Adjustments'), h('ul.rank', row(`${getState().boot.settings.tax.label}`, money(r.sales.tax)), row('Discounts', money(r.sales.discount)), row(`Refunds`, money(r.refundTotal)), row(`Voids (${r.voids.n})`, money(r.voids.amount)), row('Net sales', money(r.net))))),
    r.movements.length ? h('div', h('h4', 'Cash movements'), h('ul.rank', r.movements.map((mv) => h('li', badge(mv.kind === 'in' ? 'in' : 'out', mv.kind === 'in' ? 'ok' : 'warn'), h('span', mv.reason), h('small.muted', fmtDate(mv.created_at, { timeStyle: 'short' })), h('b', money(mv.amount)))))) : null);
}

function printReport(title, r) {
  const w = window.open('', '_blank', 'width=420,height=720');
  if (!w) return toast('Allow pop-ups to print', 'warn');
  const biz = getState().boot.settings.business;
  const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((x) => x.cssText).join('\n'); } catch { return ''; } }).join('\n');
  w.document.write(`<!doctype html><title>${title}</title><style>${css} body{background:#fff;padding:16px} .z-cols{display:grid;gap:12px}</style>`);
  w.document.body.append(h('div', h('h2', `${biz.name} — ${title}`), h('p.muted', `Shift #${r.shiftId} · printed ${new Date().toLocaleString()}`), reportView(r)));
  setTimeout(() => w.print(), 300);
}
