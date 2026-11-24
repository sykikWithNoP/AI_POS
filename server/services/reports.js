// Reports. Money in minor units. The sales register follows the IRD sales book layout
// (date in BS, invoice, buyer, buyer PAN, total, exempt, taxable, VAT), with credit notes as negative rows.
import { db } from '../db.js';
import { badRequest } from '../lib.js';
import { getGroup } from './settings.js';
import { fiscalYear, bsDate } from '../nepali.js';
import { toMajor } from '../../shared/billing.js';

export const REPORTS = ['sales-register', 'vat-summary', 'profit-by-item', 'slow-moving', 'top-customers', 'stock-movements'];

export function fiscalYears() {
  const rows = db.prepare('SELECT DISTINCT fiscal_year FROM sales ORDER BY fiscal_year DESC').all().map((r) => r.fiscal_year);
  const cur = fiscalYear();
  return rows.includes(cur) ? rows : [cur, ...rows];
}

const BS_MONTHS = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
// Fiscal-year order of BS months (Shrawan first).
export const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((m) => ({ value: String(m).padStart(2, '0'), label: BS_MONTHS[m - 1] }));

function checkFy(fy) {
  if (!/^\d{4}\.\d{3}$/.test(String(fy || ''))) throw badRequest('fy must look like 2083.084');
  return String(fy);
}

/** Sales register (sales book). month = BS month number "01".."12" (optional). Includes imported history only when asked. */
export function salesRegister({ fy = fiscalYear(), month, includeImported } = {}) {
  fy = checkFy(fy);
  const args = [fy];
  let where = 's.fiscal_year = ?';
  if (month) { where += " AND substr(s.bs_date, 6, 2) = ?"; args.push(String(month).padStart(2, '0')); }
  if (!includeImported) where += ' AND COALESCE(s.imported, 0) = 0';
  const sales = db.prepare(`SELECT s.id, s.bs_date, s.invoice_no, s.customer_name, s.customer_pan, s.total, s.exempt, s.taxable, s.tax, s.status, s.void_reason
    FROM sales s WHERE ${where} AND (s.status != 'pending' OR s.postponed = 1) ORDER BY s.id`).all(...args);
  const rows = sales.map((s) => ({
    kind: s.status === 'void' ? 'cancelled' : 'sale', date: s.bs_date, number: s.invoice_no, buyer: s.customer_name || '', buyerPan: s.customer_pan || '',
    total: s.status === 'void' ? 0 : s.total, exempt: s.status === 'void' ? 0 : s.exempt, taxable: s.status === 'void' ? 0 : s.taxable, vat: s.status === 'void' ? 0 : s.tax,
    note: s.status === 'void' ? `Cancelled: ${s.void_reason || ''}` : '',
  }));
  // Credit notes (sales returns) in the same fiscal year.
  const cn = db.prepare(`SELECT r.credit_note, r.created_at, r.amount, r.taxable, r.tax, r.reason, s.invoice_no, s.customer_name, s.customer_pan, s.exempt AS sale_exempt, s.total AS sale_total
    FROM refunds r JOIN sales s ON s.id = r.sale_id WHERE s.fiscal_year = ? ORDER BY r.id`).all(fy);
  for (const r of cn) {
    const exempt = r.sale_total ? Math.round((r.sale_exempt / r.sale_total) * r.amount) : 0;
    rows.push({ kind: 'credit-note', date: r.created_at.slice(0, 10), bsDate: bsDate(new Date(r.created_at)), number: r.credit_note, buyer: r.customer_name || '', buyerPan: r.customer_pan || '',
      total: -r.amount, exempt: -exempt, taxable: -(r.taxable - exempt), vat: -r.tax, note: `Return against ${r.invoice_no}: ${r.reason}` });
  }
  const totals = rows.reduce((t, r) => ({ total: t.total + r.total, exempt: t.exempt + r.exempt, taxable: t.taxable + r.taxable, vat: t.vat + r.vat }), { total: 0, exempt: 0, taxable: 0, vat: 0 });
  const biz = getGroup('business');
  return { fy, month: month || null, seller: { name: biz.name, pan: biz.pan, address: biz.address }, rows, totals, generatedAt: new Date().toISOString() };
}

/** Month-by-month VAT summary for a fiscal year (sales side), for the VAT return. */
export function vatSummary({ fy = fiscalYear() } = {}) {
  fy = checkFy(fy);
  const reg = salesRegister({ fy });
  const byMonth = new Map(FY_MONTHS.map((m) => [m.value, { month: m.label, bills: 0, total: 0, exempt: 0, taxable: 0, vat: 0, creditNotes: 0 }]));
  for (const r of reg.rows) {
    let mm;
    if (r.kind === 'credit-note') {
      // Credit notes carry AD dates; place them in their BS month.
      mm = null;
      try { mm = bsDate(new Date(`${r.date}T12:00:00`)).slice(5, 7); } catch { /* ignore */ }
    } else mm = r.date.slice(5, 7);
    const b = byMonth.get(mm) || byMonth.get(FY_MONTHS[0].value);
    if (r.kind === 'sale') b.bills++;
    if (r.kind === 'credit-note') b.creditNotes++;
    b.total += r.total; b.exempt += r.exempt; b.taxable += r.taxable; b.vat += r.vat;
  }
  return { fy, months: [...byMonth.values()], totals: reg.totals };
}

/** Profit per item over a date range (cost at time of sale; falls back to current cost for older bills). */
export function profitByItem({ from, to } = {}) {
  const [f, t] = range(from, to);
  const rows = db.prepare(`SELECT si.name, SUM(si.qty - si.refunded_qty) AS qty,
      SUM((si.total - si.tax) * (si.qty - si.refunded_qty) / si.qty) AS revenue,
      SUM(COALESCE(si.unit_cost, i.cost, 0) * (si.qty - si.refunded_qty)) AS cost
    FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN items i ON i.id = si.item_id
    WHERE s.status = 'paid' AND s.imported = 0 AND s.created_at >= ? AND s.created_at < ? AND si.qty > 0
    GROUP BY si.name ORDER BY revenue DESC`).all(f, t);
  return { from: f, to: t, rows: rows.map((r) => ({ ...r, revenue: Math.round(r.revenue), cost: Math.round(r.cost), profit: Math.round(r.revenue - r.cost), margin: r.revenue ? Math.round(((r.revenue - r.cost) / r.revenue) * 1000) / 10 : 0 })) };
}

/** Items with stock that sold little or nothing in the last `days` days. */
export function slowMoving({ days = 30 } = {}) {
  const d = Math.max(1, Math.min(365, Number(days) || 30));
  const since = new Date(Date.now() - d * 86400_000).toISOString();
  const rows = db.prepare(`SELECT i.id, i.name, i.category, i.stock, i.unit, i.cost,
      COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.item_id = i.id AND s.status = 'paid' AND s.created_at >= ?), 0) AS sold,
      (SELECT MAX(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.item_id = i.id AND s.status = 'paid') AS last_sold
    FROM items i WHERE i.active = 1 AND i.stock IS NOT NULL AND i.stock > 0 ORDER BY sold ASC, i.stock * i.cost DESC LIMIT 200`).all(since);
  return { days: d, rows: rows.map((r) => ({ ...r, stockValue: Math.round(r.stock * r.cost), daysOfCover: r.sold ? Math.round((r.stock / (r.sold / d)) * 10) / 10 : null })) };
}

export function topCustomers({ from, to } = {}) {
  const [f, t] = range(from, to);
  return { from: f, to: t, rows: db.prepare(`SELECT c.id, c.name, c.phone, COUNT(s.id) AS bills, SUM(s.total - s.refunded) AS spent, MAX(s.created_at) AS last_visit, c.points
      FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.status = 'paid' AND s.created_at >= ? AND s.created_at < ?
      GROUP BY c.id ORDER BY spent DESC LIMIT 100`).all(f, t).map((r) => ({ ...r, avg: r.bills ? Math.round(r.spent / r.bills) : 0 })) };
}

export function stockMovements({ from, to } = {}) {
  const [f, t] = range(from, to);
  return { from: f, to: t, rows: db.prepare(`SELECT item_name, kind, SUM(qty) AS qty, COUNT(*) AS entries, SUM(COALESCE(unit_cost,0) * qty) AS value
      FROM stock_movements WHERE created_at >= ? AND created_at < ? GROUP BY item_name, kind ORDER BY item_name, kind`).all(f, t) };
}

function range(from, to) {
  const t = to ? new Date(to) : new Date(Date.now() + 86400_000);
  const f = from ? new Date(from) : new Date(t.getTime() - 31 * 86400_000);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw badRequest('Invalid date range');
  return [f.toISOString(), t.toISOString()];
}

export function run(name, q) {
  switch (name) {
    case 'sales-register': return salesRegister({ fy: q.fy, month: q.month, includeImported: q.includeImported === '1' });
    case 'vat-summary': return vatSummary({ fy: q.fy });
    case 'profit-by-item': return profitByItem(q);
    case 'slow-moving': return slowMoving(q);
    case 'top-customers': return topCustomers(q);
    case 'stock-movements': return stockMovements(q);
    default: throw badRequest('Unknown report');
  }
}

/** Flat CSV columns per report (major units). */
export function csvColumns(name) {
  const m = (k) => (r) => toMajor(r[k] || 0);
  return {
    'sales-register': [['Date', 'date'], ['Bill/CN no.', 'number'], ['Buyer', 'buyer'], ['Buyer PAN', 'buyerPan'], ['Total sales', m('total')], ['Exempt sales', m('exempt')], ['Taxable amount', m('taxable')], ['VAT', m('vat')], ['Type', 'kind'], ['Note', 'note']],
    'vat-summary': [['Month', 'month'], ['Bills', 'bills'], ['Credit notes', 'creditNotes'], ['Total', m('total')], ['Exempt', m('exempt')], ['Taxable', m('taxable')], ['VAT', m('vat')]],
    'profit-by-item': [['Item', 'name'], ['Qty', 'qty'], ['Revenue (ex VAT)', m('revenue')], ['Cost', m('cost')], ['Profit', m('profit')], ['Margin %', 'margin']],
    'slow-moving': [['Item', 'name'], ['Category', 'category'], ['Stock', 'stock'], ['Sold in period', 'sold'], ['Last sold', 'last_sold'], ['Stock value', m('stockValue')], ['Days of cover', 'daysOfCover']],
    'top-customers': [['Customer', 'name'], ['Phone', 'phone'], ['Bills', 'bills'], ['Spent', m('spent')], ['Average', m('avg')], ['Points', 'points'], ['Last visit', 'last_visit']],
    'stock-movements': [['Item', 'item_name'], ['Type', 'kind'], ['Qty', 'qty'], ['Entries', 'entries'], ['Value', m('value')]],
  }[name].map(([label, k]) => ({ label, get: typeof k === 'function' ? k : (r) => r[k] }));
}
