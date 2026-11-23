// Server-rendered public pages: the online bill (shareable link) and payment return pages.
import { Router } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { getGroup } from '../services/settings.js';
import { getSaleByToken } from '../services/sales.js';
import * as payments from '../services/payments.js';
import { decodeReturn } from '../providers/esewa.js';
import { formatMoney } from '../../shared/billing.js';
import { baseUrl } from './routes.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex,nofollow,noai,noimageai"><link rel="stylesheet" href="/css/bill.css"></head><body>${body}</body></html>`;

const SANDBOX_JS = globalThis.__POS_SANDBOX__ ?? fs.readFileSync(new URL('../sandbox/runtime.js', import.meta.url), 'utf8');

export function pagesRouter() {
  const r = Router();

  // Extension sandbox. Loaded in <iframe sandbox="allow-scripts"> (opaque origin: no cookies, storage or
  // parent DOM). Its CSP forbids every network request, so extension code cannot exfiltrate anything.
  r.get('/sandbox.html', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    res.set({
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts`,
      'Cache-Control': 'no-store',
    });
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>sandbox</title><script nonce="${nonce}">${SANDBOX_JS}</script>`);
  });

  r.get('/b/:token', async (req, res) => {
    let sale;
    try { sale = getSaleByToken(req.params.token); } catch { return res.status(404).send(shell('Bill not found', '<main class="bill"><h1>Bill not found</h1></main>')); }
    const biz = getGroup('business');
    const tax = getGroup('tax');
    const m = (v) => formatMoney(v, biz.currencySymbol, biz.locale);
    const url = `${baseUrl(req)}/b/${sale.public_token}`;
    const qr = await QRCode.toString(url, { type: 'svg', margin: 0 });
    const isTaxInvoice = tax.rate > 0 && biz.pan;
    const status = { paid: ['Paid', 'ok'], pending: ['Payment pending', 'warn'], void: ['Cancelled', 'bad'] }[sale.status];
    const body = `
<main class="bill">
  <header>
    ${biz.logoUrl ? `<img class="logo" src="${esc(biz.logoUrl)}" alt="">` : ''}
    <h1>${esc(biz.name)}</h1>
    <p>${esc(biz.address)}${biz.phone ? ` · ${esc(biz.phone)}` : ''}</p>
    ${biz.pan ? `<p>PAN/VAT: <b>${esc(biz.pan)}</b></p>` : ''}
    <h2>${isTaxInvoice ? 'TAX INVOICE' : 'INVOICE'}</h2>
    <span class="badge ${status[1]}">${status[0]}</span>
  </header>
  <section class="meta">
    <div><span>Invoice</span><b>${esc(sale.invoice_no)}</b></div>
    <div><span>Date</span><b>${new Date(sale.created_at).toLocaleString(biz.locale)}</b></div>
    <div><span>Miti (BS)</span><b>${esc(sale.bs_date)}</b></div>
    <div><span>Fiscal year</span><b>${esc(sale.fiscal_year)}</b></div>
    ${sale.customer_name ? `<div><span>Customer</span><b>${esc(sale.customer_name)}</b></div>` : ''}
    ${sale.customer_pan ? `<div><span>Buyer PAN</span><b>${esc(sale.customer_pan)}</b></div>` : ''}
  </section>
  <table>
    <thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
    <tbody>${sale.items.map((i) => `<tr><td>${esc(i.name)}${i.discount ? `<small>disc. ${m(i.discount)}</small>` : ''}</td><td class="n">${i.qty}</td><td class="n">${m(i.unit_price)}</td><td class="n">${m(Math.round(i.unit_price * i.qty) - i.discount)}</td></tr>`).join('')}</tbody>
  </table>
  <section class="totals">
    <div><span>Subtotal</span><b>${m(sale.subtotal)}</b></div>
    ${sale.discount ? `<div><span>Discount</span><b>-${m(sale.discount)}</b></div>` : ''}
    ${sale.service_charge ? `<div><span>Service charge</span><b>${m(sale.service_charge)}</b></div>` : ''}
    <div><span>Taxable amount</span><b>${m(sale.taxable)}</b></div>
    ${sale.exempt ? `<div><span>Tax exempt</span><b>${m(sale.exempt)}</b></div>` : ''}
    <div><span>${esc(tax.label)}</span><b>${m(sale.tax)}</b></div>
    <div class="grand"><span>Total</span><b>${m(sale.total)}</b></div>
    ${sale.paid ? `<div><span>Paid (${esc(sale.payment_method || '')})</span><b>${m(sale.paid)}</b></div>` : ''}
    ${sale.change_due ? `<div><span>Change</span><b>${m(sale.change_due)}</b></div>` : ''}
  </section>
  ${sale.status === 'void' ? `<p class="void">This bill was cancelled: ${esc(sale.void_reason)}</p>` : ''}
  ${sale.ird_status === 'synced' ? '<p class="ird">✓ Reported to IRD (CBMS)</p>' : ''}
  <footer>
    <div class="qr">${qr}</div>
    <p>${esc(biz.receiptFooter)}</p>
    <button id="print-btn" class="noprint">Print / Save PDF</button>
    <script nonce="${res.locals.nonce}">document.getElementById('print-btn').addEventListener('click',()=>print())</script>
  </footer>
</main>${req.query.print ? `<script nonce="${res.locals.nonce}">addEventListener("load",()=>setTimeout(()=>print(),200))</script>` : ''}`;
    res.set('Cache-Control', 'no-store').send(shell(`${biz.name} · ${sale.invoice_no}`, body));
  });

  // Payment return pages: never trust query params, always re-verify with the provider.
  const done = (res, ok, msg) => res.send(shell('Payment', `<main class="bill center"><h1>${ok ? '✅ Payment received' : '⏳ ' + esc(msg)}</h1>
    <p>${ok ? 'You can close this window.' : 'The POS will update automatically once the payment is confirmed.'}</p></main>
    <script nonce="${res.locals.nonce}">try{window.opener&&window.opener.postMessage({type:'pos:payment-return'},location.origin)}catch(e){}${ok ? 'setTimeout(()=>window.close(),2500)' : ''}</script>`));

  const verifyAndRespond = async (req, res, failedMsg) => {
    const pid = Number(req.query.pid);
    if (!pid) return done(res, false, 'Unknown payment');
    try {
      const p = await payments.verifyWithProvider(pid);
      return done(res, p.status === 'verified', p.status === 'failed' ? 'Payment failed' : failedMsg);
    } catch (e) { return done(res, false, e.message); }
  };

  r.get('/pay/esewa/return', async (req, res) => {
    if (req.query.failed) return done(res, false, 'Payment cancelled');
    if (req.query.data) {
      const { valid } = decodeReturn(getGroup('esewa'), req.query.data);
      if (!valid) return done(res, false, 'Signature check failed');
    }
    return verifyAndRespond(req, res, 'Waiting for eSewa confirmation');
  });
  r.get('/pay/khalti/return', (req, res) => verifyAndRespond(req, res, 'Waiting for Khalti confirmation'));
  r.get('/pay/stripe/return', (req, res) => (req.query.cancelled ? done(res, false, 'Payment cancelled') : verifyAndRespond(req, res, 'Waiting for Stripe confirmation')));

  return r;
}
