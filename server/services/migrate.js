// Moving from another system: items, customers, opening stock and past sales from CSV/TSV/JSON exports.
// Preview → column mapping (auto-suggested) → dry run (rolled back) → import. Everything in one savepoint,
// so a failed import changes nothing. Imported sales are history only: never sent to IRD.
import { db, nowIso } from '../db.js';
import { badRequest } from '../lib.js';
import { toMinor } from '../../shared/billing.js';
import { createItem, updateItem, adjustStock } from './items.js';
import { createCustomer, updateCustomer } from './customers.js';
import { bsDate, fiscalYear } from '../nepali.js';
import { append as appendLedger, saleSnapshot } from '../security/ledger.js';
import { randomToken } from '../lib.js';

export const KINDS = {
  items: { label: 'Items / products', fields: {
    name: ['name', 'item', 'item name', 'product', 'product name', 'description', 'particulars'], price: ['price', 'rate', 'selling price', 'sp', 'mrp', 'sales price', 'unit price'],
    sku: ['sku', 'code', 'item code', 'product code'], barcode: ['barcode', 'ean', 'upc', 'bar code'], category: ['category', 'group', 'department', 'type'],
    cost: ['cost', 'cost price', 'purchase price', 'cp', 'buying price'], stock: ['stock', 'qty', 'quantity', 'on hand', 'balance', 'closing stock'],
    tax_rate: ['tax', 'vat', 'tax rate', 'vat %', 'vat rate'], unit: ['unit', 'uom'] }, required: ['name', 'price'] },
  customers: { label: 'Customers', fields: {
    name: ['name', 'customer', 'customer name', 'party', 'party name'], phone: ['phone', 'mobile', 'contact', 'phone number', 'mobile no'], email: ['email', 'e-mail'],
    pan: ['pan', 'vat no', 'pan no', 'vat number', 'pan number'], points: ['points', 'loyalty', 'loyalty points'], notes: ['notes', 'remarks', 'address'] }, required: ['name'] },
  stock: { label: 'Opening stock', fields: {
    sku: ['sku', 'code', 'item code'], barcode: ['barcode', 'ean'], name: ['name', 'item', 'item name', 'product'], qty: ['qty', 'quantity', 'stock', 'closing stock', 'on hand', 'balance'] }, required: ['qty'] },
  sales: { label: 'Past sales (history)', fields: {
    invoice_no: ['invoice', 'invoice no', 'bill no', 'bill number', 'invoice number', 'voucher no'], date: ['date', 'invoice date', 'bill date', 'created'],
    customer: ['customer', 'party', 'buyer', 'customer name', 'buyer name'], pan: ['pan', 'buyer pan', 'vat no'], total: ['total', 'amount', 'grand total', 'net amount', 'bill amount'],
    taxable: ['taxable', 'taxable amount'], tax: ['vat', 'tax', 'vat amount'], payment: ['payment', 'mode', 'payment mode', 'paid by'] }, required: ['invoice_no', 'date', 'total'] },
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ');

/** Parse CSV / TSV / semicolon / JSON. Returns { columns, rows }. */
export function parse(text) {
  const t = String(text || '').replace(/^﻿/, '');
  if (t.length > 10 * 1024 * 1024) throw badRequest('File is too large (max 10 MB)');
  const trimmed = t.trim();
  if (!trimmed) throw badRequest('The file is empty');
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let data;
    try { data = JSON.parse(trimmed); } catch { throw badRequest('Invalid JSON'); }
    const rows = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : Array.isArray(data.data) ? data.data : null;
    if (!rows || !rows.length || typeof rows[0] !== 'object') throw badRequest('JSON must be a list of records');
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] == null ? '' : String(r[c])]))) };
  }
  const first = trimmed.split(/\r?\n/, 1)[0];
  const delim = [',', '\t', ';', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const table = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') q = false; else field += ch; }
    else if (ch === '"' && field === '') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some((f) => f.trim())) table.push(row); row = []; }
    else field += ch;
  }
  row.push(field); if (row.some((f) => f.trim())) table.push(row);
  if (table.length < 2) throw badRequest('Need a header row and at least one data row');
  const columns = table[0].map((c, i) => c.trim() || `Column ${i + 1}`);
  return { columns, rows: table.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? '').trim()]))) };
}

export function suggestMapping(kind, columns) {
  const def = KINDS[kind];
  const out = {};
  for (const [field, names] of Object.entries(def.fields)) {
    const hit = columns.find((c) => names.includes(norm(c))) || columns.find((c) => names.some((n) => norm(c).includes(n)));
    if (hit && !Object.values(out).includes(hit)) out[field] = hit;
  }
  return out;
}

export function preview({ kind, text }) {
  if (!KINDS[kind]) throw badRequest('Choose what to import');
  const { columns, rows } = parse(text);
  return { kind, columns, rowCount: rows.length, sample: rows.slice(0, 15), mapping: suggestMapping(kind, columns), fields: Object.keys(KINDS[kind].fields), required: KINDS[kind].required };
}

const num = (v) => { const n = Number(String(v ?? '').replace(/[, ]/g, '').replace(/^Rs\.?/i, '')); return Number.isFinite(n) ? n : NaN; };

function parseDate(v) {
  const s = String(v || '').trim();
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)) && Number(m[1]) < 2050) return new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T12:00:00`);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s))) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T12:00:00`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function importRow(kind, r, stats) {
  if (kind === 'items') {
    const price = num(r.price);
    if (!r.name) throw new Error('missing name');
    if (!(price >= 0)) throw new Error(`bad price "${r.price}"`);
    const data = { name: r.name, price, category: r.category || 'General', ...(r.sku ? { sku: r.sku } : {}), ...(r.barcode ? { barcode: r.barcode } : {}),
      ...(r.cost !== undefined && r.cost !== '' ? { cost: num(r.cost) || 0 } : {}), ...(r.stock !== undefined && r.stock !== '' ? { stock: num(r.stock) } : {}),
      ...(r.tax_rate !== undefined && r.tax_rate !== '' ? { tax_rate: num(String(r.tax_rate).replace('%', '')) } : {}), ...(r.unit ? { unit: r.unit } : {}) };
    const existing = (r.sku && db.prepare('SELECT id FROM items WHERE sku = ?').get(r.sku)) || (r.barcode && db.prepare('SELECT id FROM items WHERE barcode = ?').get(r.barcode));
    if (existing) { updateItem(existing.id, data); stats.updated++; } else { createItem(data); stats.created++; }
  } else if (kind === 'customers') {
    if (!r.name) throw new Error('missing name');
    const phone = r.phone ? String(r.phone).replace(/[^\d+]/g, '') : '';
    const pan = r.pan && /^\d{9}$/.test(String(r.pan).trim()) ? String(r.pan).trim() : undefined;
    const data = { name: r.name, ...(phone ? { phone } : {}), ...(r.email ? { email: r.email } : {}), ...(pan ? { pan } : {}), ...(r.notes ? { notes: r.notes } : {}) };
    const existing = phone && db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
    const c = existing ? updateCustomer(existing.id, data) : createCustomer(data);
    existing ? stats.updated++ : stats.created++;
    const pts = Math.floor(num(r.points));
    if (pts > 0) db.prepare('UPDATE customers SET points = ? WHERE id = ?').run(pts, c.id);
  } else if (kind === 'stock') {
    const qty = num(r.qty);
    if (!Number.isFinite(qty)) throw new Error(`bad quantity "${r.qty}"`);
    const it = (r.sku && db.prepare('SELECT * FROM items WHERE sku = ?').get(r.sku)) || (r.barcode && db.prepare('SELECT * FROM items WHERE barcode = ?').get(r.barcode))
      || (r.name && db.prepare('SELECT * FROM items WHERE lower(name) = lower(?)').get(r.name));
    if (!it) throw new Error(`no item matches ${r.sku || r.barcode || r.name}`);
    if (it.stock === null) { db.prepare('UPDATE items SET stock = 0 WHERE id = ?').run(it.id); it.stock = 0; }
    const delta = qty - it.stock;
    if (delta) adjustStock(it.id, delta, { kind: 'opening', reason: 'Imported opening stock' });
    stats.updated++;
  } else if (kind === 'sales') {
    const total = toMinor(num(r.total));
    if (!r.invoice_no) throw new Error('missing invoice number');
    if (!(total > 0)) throw new Error(`bad total "${r.total}"`);
    const d = parseDate(r.date);
    if (!d) throw new Error(`bad date "${r.date}"`);
    const ref = String(r.invoice_no).trim().slice(0, 60);
    if (db.prepare('SELECT 1 FROM sales WHERE imported = 1 AND import_ref = ?').get(ref)) { stats.skipped++; return; }
    const tax = r.tax !== undefined && r.tax !== '' ? toMinor(num(r.tax)) : 0;
    const taxable = r.taxable !== undefined && r.taxable !== '' ? toMinor(num(r.taxable)) : tax ? total - tax : 0;
    const exempt = Math.max(0, total - taxable - tax);
    const pan = r.pan && /^\d{9}$/.test(String(r.pan).trim()) ? String(r.pan).trim() : null;
    const at = d.toISOString();
    const ins = db.prepare(`INSERT INTO sales (invoice_no, fiscal_year, bs_date, status, customer_name, customer_pan, subtotal, discount, service_charge, taxable, exempt, tax, total, paid,
        payment_method, public_token, ird_status, created_at, paid_at, imported, import_ref, notes)
      VALUES (?, ?, ?, 'paid', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, 'off', ?, ?, 1, ?, 'Imported from previous system')`)
      .run(`IMP-${ref}`, fiscalYear(d), bsDate(d), r.customer || null, pan, total - tax, taxable, exempt, tax, total, total, String(r.payment || 'imported').slice(0, 30), randomToken(18), at, at, ref);
    const id = Number(ins.lastInsertRowid);
    db.prepare('INSERT INTO sale_items (sale_id, item_id, name, qty, unit_price, discount, tax_rate, tax, total) VALUES (?, NULL, ?, 1, ?, 0, ?, ?, ?)')
      .run(id, `Imported bill ${ref}`, total - tax, tax ? Math.round((tax / Math.max(1, taxable)) * 100) : 0, tax, total);
    appendLedger('sale.issued', id, saleSnapshot(id));
    stats.created++;
  }
}

export function run({ kind, text, mapping, dryRun = true }) {
  if (!KINDS[kind]) throw badRequest('Choose what to import');
  const { rows } = parse(text);
  if (rows.length > 20000) throw badRequest('Up to 20,000 rows per import');
  const map = mapping || {};
  for (const f of KINDS[kind].required) if (!map[f]) throw badRequest(`Choose which column holds "${f}"`);
  const stats = { rows: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
  db.exec('SAVEPOINT migrate');
  try {
    rows.forEach((src, i) => {
      const r = Object.fromEntries(Object.entries(map).filter(([, col]) => col).map(([field, col]) => [field, src[col]]));
      db.exec('SAVEPOINT row');
      try { importRow(kind, r, stats); db.exec('RELEASE row'); }
      catch (e) { db.exec('ROLLBACK TO row'); db.exec('RELEASE row'); stats.errors.push({ row: i + 2, error: e.message }); }
    });
    if (dryRun) { db.exec('ROLLBACK TO migrate'); db.exec('RELEASE migrate'); }
    else {
      appendLedger('migration.imported', kind, { rows: stats.rows, created: stats.created, updated: stats.updated, skipped: stats.skipped, errors: stats.errors.length });
      db.exec('RELEASE migrate');
    }
  } catch (e) { db.exec('ROLLBACK TO migrate'); db.exec('RELEASE migrate'); throw e; }
  return { ...stats, dryRun, errors: stats.errors.slice(0, 100), errorCount: stats.errors.length, at: nowIso() };
}
