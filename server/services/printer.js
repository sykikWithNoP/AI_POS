// Receipt printing (ESC/POS) and cash drawer.
//  - network: raw TCP to a receipt printer on the LOCAL network (private IP ranges only — never the internet)
//  - system:  the OS print queue (USB printers) in raw mode: `lp` on macOS/Linux, a shared printer on Windows
//  - browser: the normal printable e-bill (handled in the browser)
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { getGroup } from './settings.js';
import { getSale } from './sales.js';
import { badRequest, HttpError, log } from '../lib.js';
import { formatMoney } from '../../shared/billing.js';
import { append as appendLedger } from '../security/ledger.js';

const ESC = 0x1b, GS = 0x1d;
const PRIVATE_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^127\./, /^169\.254\./];

export function isLocalAddress(host) {
  const h = String(host || '').trim();
  if (net.isIPv4(h)) return PRIVATE_V4.some((re) => re.test(h));
  if (net.isIPv6(h)) return h === '::1' || /^f[cd]/i.test(h) || /^fe80:/i.test(h);
  return /^[a-z0-9-]+(\.local)?$/i.test(h); // bare LAN host names (e.g. "printer" or "printer.local")
}

/** Minimal ESC/POS builder. Text is ASCII (most receipt printers lack Devanagari); other characters become "?". */
export class Receipt {
  constructor(width = 48) { this.w = width; this.parts = [Buffer.from([ESC, 0x40])]; }
  raw(bytes) { this.parts.push(Buffer.from(bytes)); return this; }
  text(s = '') { this.parts.push(Buffer.from(String(s).normalize('NFKD').replace(/[^\x20-\x7e\n]/g, '?'), 'ascii')); return this; }
  line(s = '') { return this.text(`${s}\n`); }
  align(a) { return this.raw([ESC, 0x61, { left: 0, center: 1, right: 2 }[a] ?? 0]); }
  bold(on) { return this.raw([ESC, 0x45, on ? 1 : 0]); }
  size(double) { return this.raw([GS, 0x21, double ? 0x11 : 0x00]); }
  rule(ch = '-') { return this.line(ch.repeat(this.w)); }
  pair(left, right) {
    const r = String(right); const room = this.w - r.length - 1;
    const l = String(left);
    return l.length <= room ? this.line(l + ' '.repeat(this.w - l.length - r.length) + r) : this.line(l).line(' '.repeat(this.w - r.length) + r);
  }
  wrap(s) { const words = String(s).split(/\s+/); let cur = ''; for (const wd of words) { if ((cur + ' ' + wd).trim().length > this.w) { this.line(cur); cur = wd; } else cur = (cur + ' ' + wd).trim(); } if (cur) this.line(cur); return this; }
  qr(data) {
    const d = Buffer.from(String(data), 'ascii');
    const len = d.length + 3;
    return this.raw([GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0])            // model 2
      .raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6])                           // module size
      .raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31])                        // error correction M
      .raw([GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30]).raw(d)  // store
      .raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]);                       // print
  }
  feed(n = 3) { return this.raw([ESC, 0x64, n]); }
  cut() { return this.feed(3).raw([GS, 0x56, 0x42, 0]); }
  drawer() { return this.raw([ESC, 0x70, 0, 25, 250]); }
  build() { return Buffer.concat(this.parts); }
}

export function receiptFor(sale, { width = 48, qr = true, baseUrl = '' } = {}) {
  const biz = getGroup('business'), tax = getGroup('tax');
  const m = (v) => formatMoney(v, biz.currencySymbol || 'Rs.');
  const r = new Receipt(width);
  r.align('center').bold(true).size(true).line(biz.name).size(false).bold(false);
  if (biz.address) r.wrap(biz.address);
  if (biz.phone) r.line(`Tel ${biz.phone}`);
  if (biz.pan) r.line(`PAN/VAT ${biz.pan}`);
  r.bold(true).line(tax.rate > 0 && biz.pan ? 'TAX INVOICE' : 'INVOICE').bold(false).align('left').rule();
  r.pair(`Bill ${sale.invoice_no}`, sale.bs_date);
  r.pair(new Date(sale.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }), `FY ${sale.fiscal_year}`);
  if (sale.customer_name) r.line(`Customer: ${sale.customer_name}`);
  if (sale.customer_pan) r.line(`Buyer PAN: ${sale.customer_pan}`);
  r.rule();
  for (const i of sale.items) {
    r.wrap(i.name);
    r.pair(`  ${i.qty} x ${m(i.unit_price)}`, m(Math.round(i.unit_price * i.qty) - i.discount));
  }
  r.rule();
  r.pair('Subtotal', m(sale.subtotal));
  if (sale.discount) r.pair('Discount', `-${m(sale.discount)}`);
  if (sale.service_charge) r.pair('Service charge', m(sale.service_charge));
  r.pair('Taxable', m(sale.taxable));
  if (sale.exempt) r.pair('Exempt', m(sale.exempt));
  r.pair(tax.label || 'VAT', m(sale.tax));
  r.bold(true).size(true).pair('TOTAL', m(sale.total)).size(false).bold(false);
  for (const p of sale.payments.filter((x) => x.status === 'verified')) r.pair(`Paid ${p.method}`, m(p.amount));
  if (sale.change_due) r.pair('Change', m(sale.change_due));
  if (sale.status === 'pending' && sale.postponed) r.line(`PAY LATER - due ${String(sale.due_date).slice(0, 10)}`);
  if (sale.status === 'void') r.bold(true).line('*** CANCELLED ***').bold(false);
  r.rule().align('center');
  if (biz.receiptFooter) r.wrap(biz.receiptFooter);
  const pub = (biz.publicUrl || '').replace(/\/$/, '');
  if (qr && pub) r.line('Scan for your e-bill:').qr(`${pub}/b/${sale.public_token}`);
  return r.cut().build();
}

function sendNetwork(host, port, data) {
  if (!isLocalAddress(host)) throw badRequest('Printer address must be on your local network (e.g. 192.168.1.50)');
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: Number(port) || 9100, timeout: 5000 }, () => sock.end(data));
    sock.on('close', (hadErr) => (hadErr ? null : resolve()));
    sock.on('timeout', () => { sock.destroy(); reject(new HttpError(504, `Printer at ${host} did not answer`, 'printer_timeout')); });
    sock.on('error', (e) => reject(new HttpError(502, `Printer error: ${e.code || e.message}`, 'printer_error')));
  });
}

function sendSystem(queue, data) {
  if (!/^[A-Za-z0-9 _.-]{1,64}$/.test(String(queue || ''))) throw badRequest('Printer name may only contain letters, numbers, spaces, dot, dash and underscore');
  const tmp = path.join(os.tmpdir(), `pos-receipt-${process.pid}-${Date.now()}.bin`);
  fs.writeFileSync(tmp, data);
  const done = (resolve, reject) => (err) => { fs.rm(tmp, { force: true }, () => {}); err ? reject(new HttpError(502, `Printing failed: ${err.message}`, 'printer_error')) : resolve(); };
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') execFile('cmd.exe', ['/d', '/c', 'copy', '/b', tmp, `\\\\localhost\\${queue}`], { windowsHide: true, timeout: 15000 }, done(resolve, reject));
    else execFile('lp', ['-d', queue, '-o', 'raw', tmp], { timeout: 15000 }, done(resolve, reject));
  });
}

async function send(data) {
  const p = getGroup('printer');
  if (p.mode === 'network') return sendNetwork(p.host, p.port, data);
  if (p.mode === 'system') return sendSystem(p.queue, data);
  throw badRequest('Receipt printer is set to "browser" — use the Print button instead');
}

export async function printSale(saleId, { openDrawer = false, baseUrl } = {}) {
  const p = getGroup('printer');
  const sale = getSale(saleId);
  let data = receiptFor(sale, { width: Number(p.width) || 48, qr: p.printQr, baseUrl });
  if (openDrawer) data = Buffer.concat([new Receipt().drawer().build(), data]);
  for (let i = 0; i < Math.max(1, Math.min(3, Number(p.copies) || 1)); i++) await send(data);
  return { printed: true };
}

export async function testPrint() {
  const p = getGroup('printer');
  const r = new Receipt(Number(p.width) || 48);
  r.align('center').bold(true).size(true).line('Printer test').size(false).bold(false).line(getGroup('business').name).rule()
    .align('left').pair('Width', `${p.width} characters`).pair('Mode', p.mode).line('0123456789'.repeat(Math.ceil((Number(p.width) || 48) / 10)).slice(0, Number(p.width) || 48)).cut();
  await send(r.build());
  return { printed: true };
}

export async function openDrawer(reason = 'manual') {
  await send(new Receipt().drawer().build());
  appendLedger('drawer.opened', reason, {});
  return { opened: true };
}

/** Event reaction: auto-print paid bills and pop the drawer for cash. */
export async function onSalePaid(sale) {
  const p = getGroup('printer');
  if (p.mode === 'browser') return;
  const cash = sale.payments?.some((x) => x.method === 'cash' && x.status === 'verified');
  try {
    if (p.autoPrint) await printSale(sale.id, { openDrawer: p.openDrawer && cash });
    else if (p.openDrawer && cash) await openDrawer(sale.invoice_no);
  } catch (e) { log.warn('auto print failed', { sale: sale.invoice_no, err: e.message }); }
}
