import { db, nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../lib.js';
import { emit } from '../bus.js';
import { toMinor } from '../../shared/billing.js';

const FIELDS = ['sku', 'barcode', 'name', 'category', 'price', 'cost', 'tax_rate', 'stock', 'unit', 'emoji', 'color', 'active', 'options'];

const rowOut = (r) => r && ({ ...r, active: !!r.active, options: r.options ? JSON.parse(r.options) : [] });

/**
 * Variants & add-ons: [{ name, required, multi, choices: [{ name, price (major units, may be negative) }] }]
 * Stored with prices in minor units.
 */
function cleanOptions(v) {
  if (v === null || v === undefined || v === '') return null;
  let groups = v;
  if (typeof v === 'string') { try { groups = JSON.parse(v); } catch { throw badRequest('Options must be valid JSON'); } }
  if (!Array.isArray(groups)) throw badRequest('Options must be a list of groups');
  if (groups.length > 10) throw badRequest('Up to 10 option groups');
  const out = groups.map((g) => {
    const name = String(g?.name || '').trim().slice(0, 40);
    if (!name) throw badRequest('Each option group needs a name');
    const choices = (Array.isArray(g.choices) ? g.choices : []).map((c) => {
      const cn = String(c?.name || '').trim().slice(0, 40);
      if (!cn) throw badRequest(`A choice in "${name}" has no name`);
      const price = toMinor(c.price ?? 0);
      if (Math.abs(price) > 1e9) throw badRequest('Choice price is too large');
      return { name: cn, price };
    });
    if (!choices.length || choices.length > 30) throw badRequest(`"${name}" needs 1–30 choices`);
    if (new Set(choices.map((c) => c.name)).size !== choices.length) throw badRequest(`Duplicate choice in "${name}"`);
    return { name, required: !!g.required, multi: !!g.multi, choices };
  });
  if (new Set(out.map((g) => g.name)).size !== out.length) throw badRequest('Option group names must be unique');
  return out.length ? JSON.stringify(out) : null;
}

/** Price and name a line from the catalog's own options — never from client prices. */
export function priceWithOptions(item, selected = []) {
  const groups = item.options || [];
  const picked = Array.isArray(selected) ? selected : [];
  let delta = 0;
  const labels = [];
  for (const g of groups) {
    const names = picked.filter((p) => p?.group === g.name).map((p) => String(p.choice));
    if (g.required && !names.length) throw badRequest(`Choose ${g.name} for ${item.name}`);
    if (!g.multi && names.length > 1) throw badRequest(`Only one ${g.name} for ${item.name}`);
    for (const n of new Set(names)) {
      const c = g.choices.find((x) => x.name === n);
      if (!c) throw badRequest(`"${n}" is not a ${g.name} option for ${item.name}`);
      delta += c.price; labels.push(c.name);
    }
  }
  for (const p of picked) if (!groups.some((g) => g.name === p?.group)) throw badRequest(`${item.name} has no option group "${p?.group}"`);
  const unitPrice = item.price + delta;
  if (unitPrice < 0) throw badRequest('Options make the price negative');
  return { unitPrice, name: labels.length ? `${item.name} (${labels.join(', ')})` : item.name, selected: picked };
}

/** Validate and normalise item input. Prices arrive in major units (e.g. 120.50). */
function clean(input, partial = false) {
  const out = {};
  for (const f of FIELDS) {
    if (!(f in input)) continue;
    let v = input[f];
    switch (f) {
      case 'name': v = String(v ?? '').trim(); if (!v) throw badRequest('Name is required'); if (v.length > 120) throw badRequest('Name too long'); break;
      case 'price': case 'cost': v = toMinor(v ?? 0); if (v < 0) throw badRequest(`${f} cannot be negative`); break;
      case 'tax_rate': v = v === '' || v === null || v === undefined ? null : Number(v); if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) throw badRequest('Tax rate must be 0-100'); break;
      case 'stock': v = v === '' || v === null || v === undefined ? null : Number(v); if (v !== null && !Number.isFinite(v)) throw badRequest('Stock must be a number'); break;
      case 'active': v = v === false || v === 0 || v === 'false' ? 0 : 1; break;
      case 'category': v = String(v || 'General').trim().slice(0, 60) || 'General'; break;
      case 'options': v = cleanOptions(v); break;
      default: v = v === '' || v === null || v === undefined ? null : String(v).trim().slice(0, 80);
    }
    out[f] = v;
  }
  if (!partial) {
    if (!('name' in out)) throw badRequest('Name is required');
    if (!('price' in out)) throw badRequest('Price is required');
  }
  if (out.unit === null) out.unit = 'pc';
  return out;
}

function uniqueGuard(fn) {
  try { return fn(); } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw conflict('An item with this SKU or barcode already exists');
    throw e;
  }
}

export function listItems({ q, category, includeInactive } = {}) {
  const where = [], args = [];
  if (!includeInactive) where.push('active = 1');
  if (category) { where.push('category = ?'); args.push(category); }
  if (q) { where.push('(name LIKE ? OR sku = ? OR barcode = ?)'); args.push(`%${q}%`, q, q); }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, name LIMIT 2000`;
  return db.prepare(sql).all(...args).map(rowOut);
}

export function getItem(id) {
  const r = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(id));
  if (!r) throw notFound('Item');
  return rowOut(r);
}

export function createItem(input) {
  const data = clean(input);
  const cols = Object.keys(data);
  const r = uniqueGuard(() => db.prepare(`INSERT INTO items (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => data[c])));
  const item = getItem(r.lastInsertRowid);
  if (item.stock !== null && item.stock !== 0) recordStockChange({ stock: 0 }, item, 'opening', 'Opening stock');
  emit('item.created', { item });
  return item;
}

export function updateItem(id, input) {
  const before = getItem(id);
  const data = clean(input, true);
  const cols = Object.keys(data);
  if (cols.length) {
    uniqueGuard(() => db.prepare(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...cols.map((c) => data[c]), nowIso(), Number(id)));
  }
  const item = getItem(id);
  if (before.stock !== null && item.stock !== null) recordStockChange(before, item, 'edit', 'Edited in item form');
  else if (before.stock === null && item.stock !== null) recordStockChange({ stock: 0 }, item, 'opening', 'Stock tracking started');
  emit('item.updated', { item });
  return item;
}

export function deleteItem(id) {
  const item = getItem(id);
  // Sales keep their own copy of name/price, so history survives deletion.
  db.prepare('DELETE FROM items WHERE id = ?').run(Number(id));
  emit('item.deleted', { item });
  return { deleted: true, id: item.id };
}

export function categories() {
  return db.prepare('SELECT category, COUNT(*) AS count FROM items WHERE active = 1 GROUP BY category ORDER BY category').all();
}

/** Bulk import from parsed CSV rows: upsert by SKU when present. */
export function importItems(rows) {
  let created = 0, updated = 0;
  const errors = [];
  rows.forEach((row, i) => {
    try {
      const existing = row.sku ? db.prepare('SELECT id FROM items WHERE sku = ?').get(String(row.sku).trim()) : null;
      if (existing) { updateItem(existing.id, row); updated++; } else { createItem(row); created++; }
    } catch (e) { errors.push({ row: i + 1, error: e.message }); }
  });
  return { created, updated, errors };
}

/**
 * The only way stock changes. Every change is written to the append-only stock history.
 * kind: sale | refund | void | in | adjust | edit | opening
 */
export function adjustStock(itemId, delta, { kind = 'adjust', ref = null, reason = null, supplier = null, unitCost = null } = {}) {
  const it = db.prepare('SELECT id, name, stock FROM items WHERE id = ?').get(itemId);
  if (!it || it.stock === null || !delta) return;
  db.prepare('UPDATE items SET stock = stock + ?, updated_at = ? WHERE id = ?').run(delta, nowIso(), itemId);
  db.prepare('INSERT INTO stock_movements (item_id, item_name, kind, qty, balance, unit_cost, reason, supplier, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(it.id, it.name, kind, delta, it.stock + delta, unitCost, reason, supplier, ref == null ? null : String(ref));
}

function recordStockChange(before, after, kind, reason) {
  if (after.stock === null || after.stock === before?.stock) return;
  const delta = after.stock - (before?.stock ?? 0);
  db.prepare('INSERT INTO stock_movements (item_id, item_name, kind, qty, balance, reason) VALUES (?, ?, ?, ?, ?, ?)')
    .run(after.id, after.name, kind, delta, after.stock, reason);
}
