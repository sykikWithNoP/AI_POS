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
  if (!cfg.enabled) return sale;
  const payload = billPayload(sale, cfg);
  try {
    const res = await send(cfg.billUrl, payload, cfg);
    const ok = res.code === 200 || res.code === 101;
    if (!ok) notify({ type: 'ird.failed', level: 'error', title: `IRD sync failed for ${sale.invoice_no}`, body: res.message, data: { saleId } });
    return setIrdState(sale.id, ok ? 'synced' : 'failed', { ...res, payload: redact(payload), at: new Date().toISOString() });
  } catch (e) {
    log.warn('ird sync error', { saleId, err: e.message });
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
