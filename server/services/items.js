import { db, nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../lib.js';
import { emit } from '../bus.js';
import { toMinor } from '../../shared/billing.js';

const FIELDS = ['sku', 'barcode', 'name', 'category', 'price', 'cost', 'tax_rate', 'stock', 'unit', 'emoji', 'color', 'active'];

const rowOut = (r) => r && ({ ...r, active: !!r.active });

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
  emit('item.created', { item });
  return item;
}

export function updateItem(id, input) {
  getItem(id);
  const data = clean(input, true);
  const cols = Object.keys(data);
  if (cols.length) {
    uniqueGuard(() => db.prepare(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...cols.map((c) => data[c]), nowIso(), Number(id)));
  }
  const item = getItem(id);
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

export function adjustStock(itemId, delta) {
  db.prepare('UPDATE items SET stock = stock + ?, updated_at = ? WHERE id = ? AND stock IS NOT NULL').run(delta, nowIso(), itemId);
}
