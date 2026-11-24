// Reports (owner area): IRD sales register, VAT summary, profit by item, slow movers, top customers, stock.
import { h, icon, money, toast, errorToast, empty, fmtDate } from '../ui.js';
import { get } from '../api.js';
import { getState } from '../store.js';

const DEFS = {
  'sales-register': { label: 'Sales register (IRD sales book)', filters: ['fy', 'month'],
    cols: [['Miti', (r) => r.bsDate || r.date], ['Bill / CN no.', (r) => r.number], ['Buyer', (r) => r.buyer], ['Buyer PAN', (r) => r.buyerPan], ['Total', (r) => r.total, 'm'], ['Exempt', (r) => r.exempt, 'm'], ['Taxable', (r) => r.taxable, 'm'], ['VAT', (r) => r.vat, 'm'], ['Note', (r) => r.note || (r.kind === 'cancelled' ? 'Cancelled' : '')]] },
  'vat-summary': { label: 'VAT summary by month', filters: ['fy'], rowsKey: 'months',
    cols: [['Month', (r) => r.month], ['Bills', (r) => r.bills, 'n'], ['Credit notes', (r) => r.creditNotes, 'n'], ['Total', (r) => r.total, 'm'], ['Exempt', (r) => r.exempt, 'm'], ['Taxable', (r) => r.taxable, 'm'], ['VAT', (r) => r.vat, 'm']] },
  'profit-by-item': { label: 'Profit by item', filters: ['range'],
    cols: [['Item', (r) => r.name], ['Qty', (r) => r.qty, 'n'], ['Revenue (ex VAT)', (r) => r.revenue, 'm'], ['Cost', (r) => r.cost, 'm'], ['Profit', (r) => r.profit, 'm'], ['Margin %', (r) => r.margin, 'n']] },
  'slow-moving': { label: 'Slow-moving stock', filters: ['days'],
    cols: [['Item', (r) => r.name], ['Stock', (r) => `${r.stock} ${r.unit}`], ['Sold', (r) => r.sold, 'n'], ['Last sold', (r) => (r.last_sold ? fmtDate(r.last_sold, { dateStyle: 'medium' }) : 'never')], ['Stock value', (r) => r.stockValue, 'm'], ['Days of cover', (r) => r.daysOfCover ?? '∞', 'n']] },
  'top-customers': { label: 'Top customers', filters: ['range'],
    cols: [['Customer', (r) => r.name], ['Phone', (r) => r.phone || ''], ['Bills', (r) => r.bills, 'n'], ['Spent', (r) => r.spent, 'm'], ['Average', (r) => r.avg, 'm'], ['Points', (r) => r.points, 'n']] },
  'stock-movements': { label: 'Stock movements', filters: ['range'],
    cols: [['Item', (r) => r.item_name], ['Type', (r) => r.kind], ['Qty', (r) => r.qty, 'n'], ['Entries', (r) => r.entries, 'n'], ['Value', (r) => r.value, 'm']] },
};

let state = { name: 'sales-register', fy: null, month: '', days: 30, from: '', to: '' };

export async function renderReports(box) {
  let meta;
  try { meta = await get('/api/reports'); } catch (e) { return errorToast(e); }
  state.fy ||= meta.fiscalYears[0];
  const out = h('div.report-out');
  const controls = h('div.toolbar');
  const query = () => {
    const q = new URLSearchParams();
    const d = DEFS[state.name];
    if (d.filters.includes('fy')) q.set('fy', state.fy);
    if (d.filters.includes('month') && state.month) q.set('month', state.month);
    if (d.filters.includes('days')) q.set('days', state.days);
    if (d.filters.includes('range')) { if (state.from) q.set('from', state.from); if (state.to) q.set('to', new Date(new Date(state.to).getTime() + 86400_000).toISOString().slice(0, 10)); }
    return q;
  };
  const drawControls = () => {
    const d = DEFS[state.name];
    const sel = h('select.input', { 'aria-label': 'Report' }, Object.entries(DEFS).map(([k, v]) => h('option', { value: k, selected: k === state.name }, v.label)));
    sel.addEventListener('change', () => { state.name = sel.value; drawControls(); load(); });
    const parts = [sel];
    if (d.filters.includes('fy')) {
      const fy = h('select.input', { 'aria-label': 'Fiscal year' }, meta.fiscalYears.map((f) => h('option', { value: f, selected: f === state.fy }, `FY ${f}`)));
      fy.addEventListener('change', () => { state.fy = fy.value; load(); }); parts.push(fy);
    }
    if (d.filters.includes('month')) {
      const mo = h('select.input', { 'aria-label': 'Month' }, h('option', { value: '' }, 'Whole year'), meta.months.map((m) => h('option', { value: m.value, selected: m.value === state.month }, m.label)));
      mo.addEventListener('change', () => { state.month = mo.value; load(); }); parts.push(mo);
    }
    if (d.filters.includes('days')) {
      const days = h('select.input', { 'aria-label': 'Period' }, [14, 30, 60, 90, 180].map((n) => h('option', { value: n, selected: n === Number(state.days) }, `Last ${n} days`)));
      days.addEventListener('change', () => { state.days = days.value; load(); }); parts.push(days);
    }
    if (d.filters.includes('range')) {
      const f = h('input.input', { type: 'date', value: state.from, 'aria-label': 'From' });
      const t = h('input.input', { type: 'date', value: state.to, 'aria-label': 'To' });
      f.addEventListener('change', () => { state.from = f.value; load(); }); t.addEventListener('change', () => { state.to = t.value; load(); });
      parts.push(f, t);
    }
    controls.replaceChildren(h('div.toolbar-actions', ...parts),
      h('div.toolbar-actions', h('a.btn', { href: `/api/reports/${state.name}?${query()}&format=csv`, onclick: (e) => { e.currentTarget.href = `/api/reports/${state.name}?${query()}&format=csv`; } }, icon('download', 16), 'CSV'),
        h('button.btn', { onclick: printIt }, icon('printer', 16), 'Print')));
  };
  let last = null;
  const load = async () => {
    out.replaceChildren(h('p.muted', 'Loading…'));
    try { last = await get(`/api/reports/${state.name}?${query()}`); draw(); } catch (e) { errorToast(e); out.replaceChildren(); }
  };
  const table = () => {
    const d = DEFS[state.name];
    const rows = last[d.rowsKey || 'rows'] || [];
    if (!rows.length) return empty('Nothing in this period', 'chart');
    const cell = (c, r) => { const v = c[1](r); return h(`td${c[2] ? '.n' : ''}`, c[2] === 'm' ? money(v) : v ?? ''); };
    const totals = last.totals && d.cols.some((c) => c[2] === 'm')
      ? h('tr.total-row', d.cols.map((c, i) => h(`td${c[2] ? '.n' : ''}`, i === 0 ? h('b', 'Total') : c[2] === 'm' && ['Total', 'Exempt', 'Taxable', 'VAT'].includes(c[0]) ? h('b', money(last.totals[c[0].toLowerCase()] ?? 0)) : ''))) : null;
    return h('div.table-wrap', h('table.table.report-table', h('thead', h('tr', d.cols.map((c) => h(`th${c[2] ? '.n' : ''}`, c[0])))),
      h('tbody', rows.map((r) => h(`tr${r.kind === 'credit-note' ? '.cn' : r.kind === 'cancelled' ? '.cancelled' : ''}`, d.cols.map((c) => cell(c, r)))), totals)));
  };
  const header = () => {
    const biz = getState().boot.settings.business;
    return h('div.report-head', h('h3', DEFS[state.name].label),
      h('p.muted', [biz.name, biz.pan ? `PAN ${biz.pan}` : null, last.fy ? `FY ${last.fy}` : null, last.month ? meta.months.find((m) => m.value === last.month)?.label : null, `Generated ${new Date(last.generatedAt || Date.now()).toLocaleString()}`].filter(Boolean).join(' · ')));
  };
  const draw = () => out.replaceChildren(header(), table());
  function printIt() {
    if (!last) return;
    const w = window.open('', '_blank', 'width=1000,height=800');
    if (!w) return toast('Allow pop-ups to print', 'warn');
    const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((x) => x.cssText).join('\n'); } catch { return ''; } }).join('\n');
    w.document.write(`<!doctype html><title>${DEFS[state.name].label}</title><style>${css} body{background:#fff;padding:16px;color:#000} .table-wrap{border:0;overflow:visible}</style>`);
    w.document.body.append(header(), table());
    setTimeout(() => w.print(), 300);
  }
  box.replaceChildren(controls, out);
  drawControls(); load();
}
