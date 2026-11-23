// Overview of the month: KPIs, daily revenue, payment mix, top items, hours, bills list, calendar.
import { h, icon, money, fmtDate, toast, errorToast, modal, confirmDialog, promptDialog, empty, badge, debounce } from '../ui.js';
import { get, post } from '../api.js';
import { getState } from '../store.js';
import { openCheckout } from './checkout.js';
import { onServerEvent } from '../live.js';

let offset = 0;
let period = 'month';
const PERIOD_LABEL = { day: 'Today', month: 'This month', year: 'This year' };

export function renderOverview(root) {
  const box = h('div.overview');
  root.replaceChildren(box);
  const reload = () => load(box).catch(errorToast);
  reload();
  const off = onServerEvent((e) => { if (['sale.paid', 'sale.void', 'sale.postponed'].includes(e.type)) reload(); });
  return off;
}

async function load(box) {
  const o = await get(`/api/overview?period=${period}&offset=${offset}`);
  const k = o.kpis;
  const delta = k.prevRevenue ? Math.round(((k.revenue - k.prevRevenue) / k.prevRevenue) * 100) : null;
  const vs = { day: 'yesterday', month: 'last month', year: 'last year' }[period];
  const setPeriod = (p) => { period = p; offset = 0; load(box); };
  const snap = o.snapshot;
  box.replaceChildren(
    h('div.snapshot', ['day', 'month', 'year'].map((p) => h(`button.snap${period === p && offset === 0 ? '.active' : ''}`, { onclick: () => setPeriod(p) },
      h('span.snap-label', PERIOD_LABEL[p], snap[p].label !== PERIOD_LABEL[p] ? h('small.muted', ` · ${snap[p].label}`) : null), h('b.snap-value', money(snap[p].revenue)), h('small.muted', `${snap[p].bills} bills`)))),
    h('div.ov-head',
      h('div.subtabs', { role: 'tablist' }, ['day', 'month', 'year'].map((p) => h(`button.subtab${period === p ? '.active' : ''}`, { role: 'tab', 'aria-selected': period === p, onclick: () => setPeriod(p) }, PERIOD_LABEL[p]))),
      h('div.month-nav',
        h('button.icon-btn', { 'aria-label': 'Previous period', onclick: () => { offset--; load(box); } }, icon('chevronLeft')),
        h('h2', o.label),
        h('button.icon-btn', { 'aria-label': 'Next period', disabled: offset >= 0, onclick: () => { offset++; load(box); } }, icon('chevronRight'))),
      h('div.toolbar-actions',
        h('a.btn', { href: `/api/sales/export.csv?from=${encodeURIComponent(o.from)}&to=${encodeURIComponent(o.to)}` }, icon('download', 16), 'Export CSV'),
        getState().boot.google.connected ? h('button.btn', { onclick: daySummary }, icon('calendar', 16), 'Close day → Calendar') : null)),
    h('div.kpis',
      kpi('Net revenue', money(k.revenue), (delta === null ? `No sales ${vs}` : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs ${vs}`) + (k.refunds ? ` · refunds ${money(k.refunds)}` : ''), delta === null ? '' : delta >= 0 ? 'up' : 'down'),
      kpi('Bills', k.bills, `${o.statusCounts.pending || 0} pending · ${o.statusCounts.void || 0} void`),
      kpi('Average bill', money(k.avgTicket), `${k.prevBills} bills ${vs}`),
      kpi(`${getState().boot.settings.tax.label} collected`, money(k.tax), `Discounts ${money(k.discount)}`),
      kpi('Est. gross profit', money(k.profit), 'Revenue − tax − item cost'),
      o.outstanding.bills ? kpi('Pay later outstanding', money(o.outstanding.amount), o.outstanding.overdue ? `${money(o.outstanding.overdue)} overdue` : `${o.outstanding.bills} bill${o.outstanding.bills === 1 ? '' : 's'}`, o.outstanding.overdue ? 'down' : '') : null),
    h('div.ov-grid',
      card({ day: 'Revenue by hour', month: 'Revenue by day', year: 'Revenue by month' }[period], barChart(o.series)),
      card('Payment methods', o.methods.length ? mix(o.methods) : empty('No payments yet', 'wallet')),
      card('Top items', o.topItems.length ? h('ol.rank', o.topItems.map((t) => h('li', h('span', t.name), h('small.muted', `${t.qty} sold`), h('b', money(t.revenue))))) : empty('No sales yet')),
      period !== 'day' ? card('Busy hours', hours(o.hours)) : null,
      card('Stock alerts', o.lowStock.length ? h('ul.rank', o.lowStock.map((i) => h('li', h('span', i.name), h('b', { class: i.stock <= 0 ? 'danger-text' : 'warn-text' }, `${i.stock} ${i.unit}`)))) : empty('All stocked', 'check')),
      card('IRD (CBMS)', irdCard(o.ird)),
      calendarCard()),
    billsSection(o));
}

const kpi = (label, value, sub, trend = '') => h('div.kpi', h('span.kpi-label', label), h('b.kpi-value', value), h(`small.kpi-sub${trend ? '.' + trend : ''}`, sub));
const card = (title, content, extra) => h('section.card', h('header.card-head', h('h3', title), extra || null), content);

function barChart(series) {
  const max = Math.max(1, ...series.map((d) => d.revenue));
  const step = Math.ceil(series.length / 12);
  return h('div.daybars', { role: 'img', 'aria-label': 'Revenue chart' }, series.map((d, i) => h('div.daybar', { title: `${d.label}: ${money(d.revenue)} (${d.bills} bills)` },
    h(`span.dbar${d.current ? '.today' : ''}`, { style: { height: `${(d.revenue / max) * 100}%` } }),
    h('small', i % step === 0 ? d.label : '\u00a0'))));
}

function mix(methods) {
  const total = methods.reduce((a, m) => a + m.amount, 0) || 1;
  return h('div.mix',
    h('div.mix-bar', methods.map((m, i) => h(`span.seg.c${i % 6}`, { style: { width: `${(m.amount / total) * 100}%` }, title: `${m.method}: ${money(m.amount)}` }))),
    h('ul.legend', methods.map((m, i) => h('li', h(`i.dot.c${i % 6}`), h('span', m.method), h('small.muted', `${m.n}×`), h('b', money(m.amount))))));
}

function hours(hrs) {
  const max = Math.max(1, ...hrs.map((x) => x.bills));
  return h('div.hours', hrs.slice(6, 23).map((x) => h('div.hour', { title: `${x.hour}:00 — ${x.bills} bills, ${money(x.revenue)}` },
    h('span.hbar', { style: { height: `${(x.bills / max) * 100}%` } }), h('small', x.hour))));
}

function irdCard(ird) {
  const cfg = getState().boot.settings.ird;
  if (!cfg.enabled) return h('div.empty', icon('shield', 28), h('p', 'IRD sync is off.'), h('a.btn.sm', { href: '#/connectors' }, 'Set up'));
  return h('ul.rank',
    h('li', h('span', 'Synced'), h('b.ok-text', ird.synced || 0)),
    h('li', h('span', 'Pending'), h('b', ird.pending || 0)),
    h('li', h('span', 'Failed'), h('b.danger-text', ird.failed || 0)),
    h('li', h('span', 'Returned (credit note)'), h('b', ird.returned || 0)),
    cfg.dryRun ? h('li', badge('Dry run — nothing sent', 'warn')) : null);
}

function calendarCard() {
  const content = h('div', h('p.muted', 'Loading…'));
  const c = card('Calendar', content, getState().boot.google.connected ? h('button.btn.sm', { onclick: () => eventDialog(() => fill()) }, icon('plus', 14), 'Event') : null);
  const fill = async () => {
    if (!getState().boot.google.connected) {
      content.replaceChildren(h('div.empty', icon('calendar', 28), h('p', 'Connect Google Calendar to see reminders, deliveries and day-close notes here.'), h('a.btn.sm', { href: '#/connectors' }, 'Connect')));
      return;
    }
    try {
      const ev = await get('/api/google/events?days=14');
      content.replaceChildren(ev.length ? h('ul.events', ev.map((e) => h('li', h('time', fmtDate(e.start, e.start.length === 10 ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' })), h('a', { href: e.link, target: '_blank', rel: 'noopener noreferrer' }, e.summary || '(no title)')))) : empty('Nothing in the next 14 days', 'calendar'));
    } catch (e) { content.replaceChildren(h('p.danger-text', e.message)); }
  };
  fill();
  return c;
}

function eventDialog(done) {
  const summary = h('input.input', { placeholder: 'e.g. Supplier delivery, VAT return due' });
  const start = h('input.input', { type: 'datetime-local' });
  modal({ title: 'New calendar event', body: h('div.form-grid', h('label.field', h('span', 'Title'), summary), h('label.field', h('span', 'When'), start)),
    actions: [{ label: 'Create', primary: true, onClick: async (c) => {
      try { await post('/api/google/events', { summary: summary.value, start: start.value }); toast('Event created', 'success'); c(); done(); } catch (e) { errorToast(e); }
    } }] });
}

async function daySummary() {
  try { await post('/api/google/day-summary'); toast('Day summary added to Google Calendar', 'success'); } catch (e) { errorToast(e); }
}

function billsSection(o) {
  let status = '', q = '';
  const tbody = h('tbody');
  const search = h('input.input', { type: 'search', placeholder: 'Invoice, customer, phone, PAN…', 'aria-label': 'Search bills' });
  const statusSel = h('select.input', { 'aria-label': 'Filter by status' }, h('option', { value: '' }, 'All'), h('option', { value: 'paid' }, 'Paid'), h('option', { value: 'pending' }, 'Pending'), h('option', { value: 'due' }, 'Pay later (due)'), h('option', { value: 'void' }, 'Void'));
  const load = async () => {
    // "Due" shows every unpaid pay-later bill regardless of period.
    const rows = status === 'due' ? await get(`/api/sales?due=1&q=${encodeURIComponent(q)}`)
      : await get(`/api/sales?from=${encodeURIComponent(o.from)}&to=${encodeURIComponent(o.to)}&status=${status}&q=${encodeURIComponent(q)}`);
    tbody.replaceChildren(...(rows.length ? rows.map((s) => h('tr', { class: 'clickable', onclick: () => billDialog(s.id, load) },
      h('td', h('b', s.invoice_no)), h('td', fmtDate(s.created_at)), h('td.muted', s.bs_date), h('td', s.customer_name || '—'),
      h('td', s.payment_method || '—'), h('td.n', h('b', money(s.total))),
      h('td', s.postponed && s.status === 'pending' ? badge(Date.parse(s.due_date) < Date.now() ? 'overdue' : `due ${s.due_date.slice(5, 10)}`, Date.parse(s.due_date) < Date.now() ? 'bad' : 'warn') : badge(s.status, { paid: 'ok', pending: 'warn', void: 'bad' }[s.status]), s.refunded ? badge('refund', 'warn') : null),
      h('td', s.ird_status === 'off' ? '—' : badge(s.ird_status, { synced: 'ok', failed: 'bad', pending: 'warn' }[s.ird_status] || '')))) : [h('tr', h('td', { colSpan: 8 }, empty('No bills match')))]));
  };
  search.addEventListener('input', debounce(() => { q = search.value.trim(); load(); }, 250));
  statusSel.addEventListener('change', () => { status = statusSel.value; load(); });
  load().catch(errorToast);
  return h('section.card.bills',
    h('header.card-head', h('h3', 'Bills'), h('div.toolbar-actions', h('div.search-wrap', icon('search', 16), search), statusSel)),
    h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', 'Invoice'), h('th', 'Date'), h('th', 'Miti'), h('th', 'Customer'), h('th', 'Method'), h('th.n', 'Total'), h('th', 'Status'), h('th', 'IRD'))), tbody)));
}

async function billDialog(id, refresh) {
  const s = await get(`/api/sales/${id}`);
  const link = `${getState().boot.baseUrl}/b/${s.public_token}`;
  const m = modal({
    title: `Bill ${s.invoice_no}`, wide: true,
    body: h('div.bill-detail',
      h('div.meta-grid',
        h('div', h('small', 'Status'), badge(s.status, { paid: 'ok', pending: 'warn', void: 'bad' }[s.status])),
        h('div', h('small', 'Date'), fmtDate(s.created_at)), h('div', h('small', 'Miti'), s.bs_date),
        h('div', h('small', 'Customer'), s.customer_name || 'Walk-in', s.customer_pan ? ` · PAN ${s.customer_pan}` : ''),
        h('div', h('small', 'IRD'), s.ird_status, s.ird_response?.message ? h('small.muted', ` — ${s.ird_response.message}`) : null),
        s.postponed ? h('div', h('small', 'Pay later'), s.status === 'pending' ? `due ${new Date(s.due_date).toLocaleDateString()} · owes ${money(s.total - s.paid)}` : 'settled') : null),
      h('table.table.compact', h('tbody', s.items.map((i) => h('tr', h('td', i.name), h('td.n', `${i.qty} × ${money(i.unit_price)}`), h('td.n', money(i.total)))),
        h('tr.total-row', h('td', 'Total'), h('td'), h('td.n', h('b', money(s.total)))))),
      s.payments.length ? h('div', h('h4', 'Payments'), h('ul.rank', s.payments.map((p) => h('li', h('span', `${p.method}${p.reference ? ' · ' + p.reference : ''}`), badge(p.status, { verified: 'ok', pending: 'warn', failed: 'bad' }[p.status] || ''), h('b', money(p.amount)))))) : null,
      s.refunds.length ? h('div', h('h4', 'Refunds'), h('ul.rank', s.refunds.map((r) => h('li', h('span', `${r.credit_note} · ${r.method} · ${r.reason}`), r.ird_status !== 'off' ? badge(`IRD ${r.ird_status}`, r.ird_status === 'synced' ? 'ok' : 'warn') : null, h('b', `−${money(r.amount)}`))))) : null,
      s.void_reason ? h('p.danger-text', `Void: ${s.void_reason}`) : null),
    actions: [
      { label: 'Open e-bill', onClick: () => window.open(`/b/${s.public_token}`, '_blank') },
      { label: 'Print', onClick: () => window.open(`/b/${s.public_token}?print=1`, '_blank', 'width=420,height=720') },
      { label: 'Copy link', onClick: () => { navigator.clipboard?.writeText(link); toast('Link copied', 'success'); } },
      ...(s.status === 'paid' && s.refunded < s.total ? [{ label: 'Refund items', onClick: (c) => { c(); refundDialog(s, refresh); } }] : []),
      ...(s.status === 'pending' ? [{ label: 'Collect payment', primary: true, onClick: (c) => { c(); openCheckout(null, null, { sale: s }); } }] : []),
      ...(s.ird_status === 'failed' || s.ird_status === 'pending' ? [{ label: 'Retry IRD sync', onClick: async (c) => { try { await post(`/api/sales/${s.id}/ird-sync`); toast('IRD sync attempted', 'info'); c(); refresh(); } catch (e) { errorToast(e); } } }] : []),
      ...(s.status !== 'void' && !s.refunded ? [{ label: 'Void bill', danger: true, onClick: async (c) => {
        const reason = await promptDialog('Reason for cancelling this bill', '', { title: 'Void bill' });
        if (!reason) return;
        if (!(await confirmDialog(`Void ${s.invoice_no}? ${s.status === 'paid' ? 'Stock is returned and, if synced, a credit note is sent to IRD.' : ''}`, { okLabel: 'Void', danger: true }))) return;
        try { await post(`/api/sales/${s.id}/void`, { reason }); toast('Bill voided', 'success'); c(); refresh(); } catch (e) { errorToast(e); }
      } }] : []),
    ],
  });
  return m;
}

function refundDialog(s, refresh) {
  const rows = s.items.filter((i) => i.qty - i.refunded_qty > 0).map((i) => {
    const left = i.qty - i.refunded_qty;
    const qty = h('input.input', { type: 'number', min: 0, max: left, step: 'any', value: 0, 'aria-label': `Refund quantity for ${i.name}` });
    return { i, qty, el: h('div.refund-line', h('div', h('b', i.name), h('small.muted', ` ${left} refundable · ${money(Math.round(i.total / i.qty))} each`)), qty, h('button.btn.sm', { type: 'button', onclick: () => { qty.value = left; } }, 'All')) };
  });
  const methods = ['cash', 'card', 'qr', 'esewa', 'khalti', 'stripe', 'store_credit'];
  const method = h('select.input', methods.map((m) => h('option', { value: m, selected: s.payment_method?.startsWith(m) }, m.replace('_', ' '))));
  const reason = h('input.input', { placeholder: 'e.g. Damaged, wrong item' });
  modal({
    title: `Refund · ${s.invoice_no}`, wide: true,
    body: h('div.form-grid', h('div.refund-lines', rows.map((r) => r.el)), h('div.form-grid.two', h('label.field', h('span', 'Refund via'), method), h('label.field', h('span', 'Reason'), reason)),
      h('p.hint', 'Stock returns to inventory, loyalty points are reversed, and if the bill was reported to IRD a credit note is sent.')),
    actions: [{ label: 'Refund', danger: true, onClick: async (c) => {
      const lines = rows.map((r) => ({ saleItemId: r.i.id, qty: Number(r.qty.value) })).filter((l) => l.qty > 0);
      if (!lines.length) return toast('Choose quantities to refund', 'warn');
      try {
        const r = await post(`/api/sales/${s.id}/refunds`, { lines, method: method.value, reason: reason.value });
        toast(`Refunded ${money(r.refund.amount)} · ${r.refund.credit_note}`, 'success', 5000); c(); refresh();
      } catch (e) { errorToast(e); }
    } }],
  });
}
