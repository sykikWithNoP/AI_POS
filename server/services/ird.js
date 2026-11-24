// Nepal IRD Central Billing Monitoring System (CBMS) sync. Optional; dry-run by default.
import { httpJson, log } from '../lib.js';
import { toMajor } from '../../shared/billing.js';
import { getGroup } from './settings.js';
import { getSale, setIrdState } from './sales.js';
import { getRefund, setRefundIrd } from './refunds.js';
import { bsDate } from '../nepali.js';
import { notify } from '../bus.js';

// CBMS returns a bare number. 200 = saved, 101 = bill already exists (treat as synced).
const CODES = { 200: 'Success', 100: 'API credentials do not match', 101: 'Bill already exists', 102: 'Exception while saving bill details', 103: 'Unknown exceptions', 104: 'Model invalid' };

const clientTime = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');

export function billPayload(sale, cfg) {
  return {
    username: cfg.username,
    password: cfg.password,
    seller_pan: cfg.sellerPan,
    buyer_pan: sale.customer_pan || '',
    fiscal_year: sale.fiscal_year,
    buyer_name: sale.customer_name || '',
    invoice_number: sale.invoice_no,
    invoice_date: sale.bs_date,
    total_sales: toMajor(sale.total),
    taxable_sales_vat: toMajor(sale.taxable),
    vat: toMajor(sale.tax),
    excisable_amount: 0, excise: 0, taxable_sales_hst: 0, hst: 0, amount_for_esf: 0, esf: 0, export_sales: 0,
    tax_exempted_sales: toMajor(sale.exempt),
    isrealtime: true,
    datetimeClient: clientTime(),
  };
}

export function returnPayload(sale, cfg) {
  const p = billPayload(sale, cfg);
  delete p.invoice_number; delete p.invoice_date;
  return { ...p, ref_invoice_number: sale.invoice_no, credit_note_number: `CN-${sale.invoice_no}`, credit_note_date: bsDate(), reason_for_return: sale.void_reason || 'Cancelled' };
}

async function send(url, payload, cfg) {
  if (cfg.dryRun) return { code: 200, message: 'Dry run (not sent)', dryRun: true };
  const r = await httpJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 20000 });
  const code = Number(r.json ?? String(r.text).trim());
  return { code, message: CODES[code] || `HTTP ${r.status}: ${String(r.text).slice(0, 200)}` };
}

const redact = (p) => ({ ...p, password: p.password ? '***' : '' });

export async function syncSale(saleId) {
  const cfg = getGroup('ird');
  const sale = getSale(saleId);
  if (!cfg.enabled || sale.imported) return sale; // history imported from an old system is never re-reported
  const payload = billPayload(sale, cfg);
  try {
    const res = await send(cfg.billUrl, payload, cfg);
    const ok = res.code === 200 || res.code === 101;
    scheduleRetry(sale.id, ok);
    if (!ok) notify({ type: 'ird.failed', level: 'error', title: `IRD sync failed for ${sale.invoice_no}`, body: res.message, data: { saleId } });
    return setIrdState(sale.id, ok ? 'synced' : 'failed', { ...res, payload: redact(payload), at: new Date().toISOString() });
  } catch (e) {
    log.warn('ird sync error', { saleId, err: e.message });
    scheduleRetry(sale.id, false);
    return setIrdState(sale.id, 'failed', { message: e.message, at: new Date().toISOString() });
  }
}

export async function returnSale(saleId) {
  const cfg = getGroup('ird');
  const sale = getSale(saleId);
  if (!cfg.enabled) return sale;
  const payload = returnPayload(sale, cfg);
  try {
    const res = await send(cfg.returnUrl, payload, cfg);
    return setIrdState(sale.id, res.code === 200 ? 'returned' : 'failed', { ...res, kind: 'return', payload: redact(payload), at: new Date().toISOString() });
  } catch (e) {
    return setIrdState(sale.id, 'failed', { kind: 'return', message: e.message, at: new Date().toISOString() });
  }
}

/** Partial return: a credit note for just the refunded lines. */
export async function returnRefund(refundId) {
  const cfg = getGroup('ird');
  const refund = getRefund(refundId);
  if (!cfg.enabled || !refund || refund.ird_status !== 'pending') return;
  const sale = getSale(refund.sale_id);
  const exemptShare = sale.total ? Math.round((sale.exempt / sale.total) * refund.amount) : 0;
  const payload = {
    ...returnPayload(sale, cfg),
    credit_note_number: refund.credit_note, reason_for_return: refund.reason,
    total_sales: toMajor(refund.amount), taxable_sales_vat: toMajor(refund.taxable - exemptShare), vat: toMajor(refund.tax), tax_exempted_sales: toMajor(exemptShare),
  };
  try {
    const res = await send(cfg.returnUrl, payload, cfg);
    setRefundIrd(refund.id, res.code === 200 ? 'synced' : 'failed', { ...res, payload: redact(payload) });
  } catch (e) {
    setRefundIrd(refund.id, 'failed', { message: e.message });
  }
}

// ---------- Easier IRD: checks, retry queue, bulk sync, filing pack ----------
import { db } from '../db.js';
import { salesRegister, vatSummary, csvColumns } from './reports.js';
import { zip } from '../util/zip.js';

const BACKOFF_MIN = [1, 5, 15, 60, 180, 720]; // minutes between automatic retries

function scheduleRetry(saleId, ok) {
  if (ok) { db.prepare('UPDATE sales SET ird_attempts = 0, ird_next_try = NULL WHERE id = ?').run(saleId); return; }
  const a = db.prepare('SELECT ird_attempts FROM sales WHERE id = ?').get(saleId)?.ird_attempts || 0;
  const next = new Date(Date.now() + BACKOFF_MIN[Math.min(a, BACKOFF_MIN.length - 1)] * 60_000).toISOString();
  db.prepare('UPDATE sales SET ird_attempts = ird_attempts + 1, ird_next_try = ? WHERE id = ?').run(next, saleId);
}

/** Configuration checklist for the wizard. */
export function status() {
  const cfg = getGroup('ird');
  const biz = getGroup('business');
  const https = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
  const checks = [
    { id: 'pan', ok: /^\d{9}$/.test(biz.pan || ''), label: 'Business PAN/VAT number (9 digits) is set' },
    { id: 'seller', ok: /^\d{9}$/.test(cfg.sellerPan || '') && cfg.sellerPan === biz.pan, label: 'Seller PAN matches the business PAN' },
    { id: 'user', ok: !!cfg.username, label: 'CBMS username is set' },
    { id: 'password', ok: !!cfg.password, label: 'CBMS password is saved' },
    { id: 'urls', ok: https(cfg.billUrl) && https(cfg.returnUrl), label: 'IRD endpoints use HTTPS' },
    { id: 'vat', ok: getGroup('tax').rate === 13, label: 'VAT rate is 13%' },
  ];
  const counts = Object.fromEntries(db.prepare("SELECT ird_status, COUNT(*) AS n FROM sales WHERE imported = 0 GROUP BY ird_status").all().map((r) => [r.ird_status, r.n]));
  const lastError = db.prepare("SELECT invoice_no, ird_response FROM sales WHERE ird_status = 'failed' ORDER BY id DESC LIMIT 1").get();
  return {
    enabled: cfg.enabled, dryRun: cfg.dryRun, autoSync: cfg.autoSync, checks, ready: checks.every((c) => c.ok), counts,
    pendingRefunds: db.prepare("SELECT COUNT(*) AS n FROM refunds WHERE ird_status IN ('pending','failed')").get().n,
    lastError: lastError ? { invoice: lastError.invoice_no, message: JSON.parse(lastError.ird_response || '{}').message } : null,
  };
}

/** Sync every issued bill that is pending or failed (and pending credit notes). */
export async function syncAll({ onlyDue = false } = {}) {
  const cfg = getGroup('ird');
  if (!cfg.enabled) return { synced: 0, failed: 0, skipped: 'IRD is off' };
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT id FROM sales WHERE imported = 0 AND ird_status IN ('pending','failed') AND (status = 'paid' OR (status = 'pending' AND postponed = 1))
    ${onlyDue ? 'AND (ird_next_try IS NULL OR ird_next_try <= ?)' : ''} ORDER BY id LIMIT 200`).all(...(onlyDue ? [now] : []));
  let synced = 0, failed = 0;
  for (const r of rows) { const s = await syncSale(r.id); s.ird_status === 'synced' ? synced++ : failed++; }
  for (const rf of db.prepare("SELECT id FROM refunds WHERE ird_status IN ('pending','failed') ORDER BY id LIMIT 100").all()) {
    db.prepare("UPDATE refunds SET ird_status = 'pending' WHERE id = ? AND ird_status = 'failed'").run(rf.id);
    await returnRefund(rf.id);
  }
  return { synced, failed };
}

let retryTimer;
export function startRetryQueue(everyMs = 60_000) {
  clearInterval(retryTimer);
  retryTimer = setInterval(async () => {
    if ((await import('../lib.js')).isLocked()) return;
    const cfg = getGroup('ird');
    if (cfg.enabled && cfg.autoSync) syncAll({ onlyDue: true }).catch((e) => log.warn('ird retry failed', { err: e.message }));
  }, everyMs);
  retryTimer.unref?.();
}

/** One ZIP with everything to attach for IRD: registers, VAT summary, credit notes, unsynced list, printable copy. */
export function filingPack({ fy, month } = {}) {
  const reg = salesRegister({ fy, month });
  const vat = vatSummary({ fy: reg.fy });
  const toCsvLocal = (rows, cols) => [cols.map((c) => c.label).join(','), ...rows.map((r) => cols.map((c) => {
    const v = c.get(r); const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','))].join('\n');
  const m = (v) => toMajor(v || 0).toFixed(2);
  const credit = reg.rows.filter((r) => r.kind === 'credit-note');
  const unsynced = db.prepare(`SELECT invoice_no, bs_date, total, ird_status, ird_attempts FROM sales WHERE fiscal_year = ? AND imported = 0
    AND ird_status IN ('pending','failed') AND (status = 'paid' OR postponed = 1) ORDER BY id`).all(reg.fy);
  const label = `${reg.fy}${reg.month ? '-' + reg.month : ''}`;
  const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<!doctype html><meta charset="utf-8"><title>Sales register ${label}</title>
<style>body{font:12px system-ui;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px}td.n{text-align:right}h1{font-size:16px}</style>
<h1>Sales register (Bikri Khata) — ${esc(reg.seller.name)} · PAN ${esc(reg.seller.pan)} · FY ${esc(reg.fy)}${reg.month ? ' · month ' + esc(reg.month) : ''}</h1>
<table><tr><th>Miti</th><th>Bill/CN no.</th><th>Buyer</th><th>Buyer PAN</th><th>Total</th><th>Exempt</th><th>Taxable</th><th>VAT</th><th>Note</th></tr>
${reg.rows.map((r) => `<tr><td>${esc(r.bsDate || r.date)}</td><td>${esc(r.number)}</td><td>${esc(r.buyer)}</td><td>${esc(r.buyerPan)}</td><td class=n>${m(r.total)}</td><td class=n>${m(r.exempt)}</td><td class=n>${m(r.taxable)}</td><td class=n>${m(r.vat)}</td><td>${esc(r.note)}</td></tr>`).join('')}
<tr><th colspan=4>Total</th><th class=n>${m(reg.totals.total)}</th><th class=n>${m(reg.totals.exempt)}</th><th class=n>${m(reg.totals.taxable)}</th><th class=n>${m(reg.totals.vat)}</th><th></th></tr></table>`;
  const summary = [
    `IRD filing pack — ${reg.seller.name} (PAN ${reg.seller.pan || 'not set'})`,
    `Fiscal year ${reg.fy}${reg.month ? `, month ${reg.month}` : ' (whole year)'}`, `Generated ${new Date().toISOString()}`, '',
    `Sales register rows: ${reg.rows.length} (credit notes: ${credit.length})`,
    `Total sales: ${m(reg.totals.total)}  Exempt: ${m(reg.totals.exempt)}  Taxable: ${m(reg.totals.taxable)}  VAT: ${m(reg.totals.vat)}`,
    `Bills not yet accepted by CBMS: ${unsynced.length}`, '',
    'Files: sales-register.csv, sales-register.html (printable), vat-summary.csv, credit-notes.csv, unsynced-bills.csv',
    'Check figures against your CBMS account before filing.',
  ].join('\n');
  const files = [
    { name: 'README.txt', data: summary },
    { name: 'sales-register.csv', data: toCsvLocal(reg.rows.map((r) => ({ ...r, date: r.bsDate || r.date })), csvColumns('sales-register')) },
    { name: 'sales-register.html', data: html },
    { name: 'vat-summary.csv', data: toCsvLocal(vat.months, csvColumns('vat-summary')) },
    { name: 'credit-notes.csv', data: toCsvLocal(credit, csvColumns('sales-register')) },
    { name: 'unsynced-bills.csv', data: toCsvLocal(unsynced, [{ label: 'Invoice', get: (r) => r.invoice_no }, { label: 'Miti', get: (r) => r.bs_date }, { label: 'Total', get: (r) => m(r.total) }, { label: 'IRD status', get: (r) => r.ird_status }, { label: 'Attempts', get: (r) => r.ird_attempts }]) },
  ];
  return { filename: `ird-filing-pack-${label}.zip`, buffer: zip(files), summary: { rows: reg.rows.length, creditNotes: credit.length, unsynced: unsynced.length, totals: reg.totals } };
}
