// Tamper-evident ledger: an append-only, HMAC-chained record of every financial event and rule change.
// Each entry signs (previous hash + kind + reference + canonical payload). Editing, deleting or reordering
// any row — or changing a bill's money fields directly in the database — breaks verification.
import { db } from '../db.js';
import { deriveKey } from '../lib.js';
import crypto from 'node:crypto';

let k;
const key = () => (k ||= deriveKey('ledger'));
const GENESIS = '0'.repeat(64);

/** Stable JSON: sorted keys, so the same data always hashes the same. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((x) => `${JSON.stringify(x)}:${canonical(v[x])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sign = (prev, kind, ref, payloadHash, at) => crypto.createHmac('sha256', key()).update(`${prev}|${kind}|${ref}|${payloadHash}|${at}`).digest('hex');

/** Fields of a bill that must never change after it is issued. */
export function saleSnapshot(saleId) {
  const s = db.prepare('SELECT invoice_no, fiscal_year, bs_date, created_at, subtotal, discount, service_charge, taxable, exempt, tax, total, customer_pan FROM sales WHERE id = ?').get(saleId);
  if (!s) return null;
  s.items = db.prepare('SELECT name, qty, unit_price, discount, tax_rate, tax, total FROM sale_items WHERE sale_id = ? ORDER BY id').all(saleId);
  return s;
}
export function refundSnapshot(refundId) {
  return db.prepare('SELECT sale_id, amount, taxable, tax, method, reason, lines, credit_note, created_at FROM refunds WHERE id = ?').get(refundId) || null;
}

/** Append an entry. `kind` e.g. 'sale.issued', 'refund', 'settings.changed', 'security.pin_failed'. */
export function append(kind, ref, payload) {
  const last = db.prepare('SELECT hash FROM ledger ORDER BY id DESC LIMIT 1').get();
  const prev = last?.hash || GENESIS;
  const at = new Date().toISOString();
  const body = canonical(payload ?? {});
  const payloadHash = sha(body);
  const hash = sign(prev, kind, String(ref ?? ''), payloadHash, at);
  db.prepare('INSERT INTO ledger (kind, ref, payload, payload_hash, prev_hash, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(kind, String(ref ?? ''), body, payloadHash, prev, hash, at);
  return hash;
}

/**
 * Verify the whole chain and re-check every bill and refund against its signed snapshot.
 * Returns { ok, entries, problems: [{id, kind, ref, reason}] }.
 */
export function verify() {
  const rows = db.prepare('SELECT * FROM ledger ORDER BY id').all();
  const problems = [];
  let prev = GENESIS;
  const latestSale = new Map(), refundsSeen = new Map();
  for (const r of rows) {
    if (r.prev_hash !== prev) problems.push({ id: r.id, kind: r.kind, ref: r.ref, reason: 'chain broken (entry removed or reordered)' });
    if (sha(r.payload) !== r.payload_hash) problems.push({ id: r.id, kind: r.kind, ref: r.ref, reason: 'entry payload edited' });
    if (sign(r.prev_hash, r.kind, r.ref, r.payload_hash, r.created_at) !== r.hash) problems.push({ id: r.id, kind: r.kind, ref: r.ref, reason: 'signature invalid' });
    if (r.kind === 'sale.issued') latestSale.set(r.ref, r.payload);
    if (r.kind === 'refund') refundsSeen.set(r.ref, r.payload);
    prev = r.hash;
  }
  // Bills: every issued bill must still match what was signed; every non-pending bill must have been signed.
  for (const [ref, payload] of latestSale) {
    const snap = saleSnapshot(Number(ref));
    if (!snap) problems.push({ kind: 'sale', ref, reason: 'issued bill was deleted' });
    else if (canonical(snap) !== payload) problems.push({ kind: 'sale', ref, reason: `bill ${snap.invoice_no} was altered after issue` });
  }
  for (const s of db.prepare('SELECT id, invoice_no FROM sales').all()) {
    if (!latestSale.has(String(s.id))) problems.push({ kind: 'sale', ref: String(s.id), reason: `bill ${s.invoice_no} is missing from the ledger` });
  }
  for (const [ref, payload] of refundsSeen) {
    const snap = refundSnapshot(Number(ref));
    if (!snap || canonical(snap) !== payload) problems.push({ kind: 'refund', ref, reason: 'refund was altered or deleted' });
  }
  for (const r of db.prepare('SELECT id FROM refunds').all()) if (!refundsSeen.has(String(r.id))) problems.push({ kind: 'refund', ref: String(r.id), reason: 'refund missing from the ledger' });
  return { ok: problems.length === 0, entries: rows.length, problems: problems.slice(0, 100), checkedAt: new Date().toISOString() };
}

export function recent({ limit = 100, kind } = {}) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = kind ? db.prepare('SELECT id, kind, ref, payload, created_at FROM ledger WHERE kind LIKE ? ORDER BY id DESC LIMIT ?').all(`${kind}%`, lim)
    : db.prepare('SELECT id, kind, ref, payload, created_at FROM ledger ORDER BY id DESC LIMIT ?').all(lim);
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}
