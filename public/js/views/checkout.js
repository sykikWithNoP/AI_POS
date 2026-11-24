// Checkout: one modal that turns a cart into a sale, collects one or more payments
// (cash / card / QR / eSewa / Khalti / Stripe) and waits for verification events.
import { h, icon, money, toMinor, toMajor, toast, errorToast, modal, chime } from '../ui.js';
import { showPaid } from '../display-link.js';
import { dispatch, getState } from '../store.js';
import { get, post } from '../api.js';
import { quickTenders } from '/shared/billing.js';
import { emitExt } from '../extensions.js';
import { onServerEvent } from '../live.js';

/** Convert the cart (minor units) to the API's input shape (major units). */
export function cartToSaleInput(cart, totals) {
  const disc = (d) => (d ? { type: d.type, value: d.type === 'amount' ? toMajor(d.value) : d.value } : undefined);
  return {
    lines: cart.lines.map((l) => (l.membershipPlanId ? { membershipPlanId: l.membershipPlanId }
      : l.itemId ? { itemId: l.itemId, qty: l.qty, discount: disc(l.discount), ...(l.options ? { options: l.options } : {}) }
        : { name: l.name, unitPrice: toMajor(l.unitPrice), qty: l.qty, taxRate: l.taxRate, discount: disc(l.discount) })),
    customerId: cart.customer?.id || undefined,
    redeemPoints: cart.redeemPoints || undefined,
    cartDiscount: disc(cart.cartDiscount),
    extraDiscounts: (totals?.rules || []).map((r) => ({ label: r.label, amount: toMajor(r.amount) })),
    customer: { name: cart.customer?.name, pan: cart.customer?.pan, phone: cart.customer?.phone, email: cart.customer?.email },
    notes: cart.notes,
  };
}

/** Open checkout for a new cart, or for an existing pending sale (pass { sale }). */
export function openCheckout(cart, totals, { sale: existing } = {}) {
  let sale = existing || null;
  const sessionId = existing ? null : getState().active; // the open bill (tab) this checkout belongs to
  let method = getState().boot.methods[0]?.id || 'cash';
  let watching = null; // pending online/QR payment
  const body = h('div.checkout');
  const off = [];

  const ensureSale = async () => {
    if (sale) return sale;
    sale = await post('/api/sales', cartToSaleInput(cart, totals));
    if (sale.total !== totals.total) toast(`Server total ${money(sale.total)} differs from screen — using server total`, 'warn');
    // The bill now lives on the server: close its tab (other open bills stay open).
    if (sessionId) dispatch({ type: 'session/close', id: sessionId });
    return sale;
  };
  const due = () => (sale ? sale.total - sale.paid : totals.total);

  const m = modal({ title: 'Checkout', body, wide: true, onClose: () => {
    off.forEach((f) => f());
    if (sale && sale.status === 'pending' && !sale.postponed) toast(`Saved as pending bill ${sale.invoice_no}. Collect it from Overview → Bills.`, 'info', 6000);
  } });

  // Live updates from the server (payment verified by poller / webhook / return page).
  off.push(onServerEvent((evt) => {
    if (!sale) return;
    const sid = evt.payload?.sale?.id ?? evt.payload?.payment?.sale_id ?? evt.payload?.saleId;
    if (sid !== sale.id) return;
    if (evt.type === 'sale.paid' || evt.type === 'sale.updated') { sale = evt.payload.sale; if (sale.status === 'paid') { success(); } else draw(); }
    if (evt.type === 'payment.failed') { watching = null; toast('Payment failed or expired', 'error'); chime('bad'); draw(); }
  }));
  const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'pos:payment-return' && watching) verifyNow(); };
  window.addEventListener('message', onMsg);
  off.push(() => window.removeEventListener('message', onMsg));

  async function verifyNow() {
    if (!watching) return;
    try { await post(`/api/payments/${watching.id}/verify`); } catch (e) { errorToast(e); }
  }

  function draw() {
    const methods = getState().boot.methods;
    body.replaceChildren(
      h('div.co-summary',
        h('div', h('small', sale ? `Bill ${sale.invoice_no}` : 'Amount due'), h('div.co-due', money(due()))),
        sale && sale.paid ? h('div.co-paid', `Paid so far ${money(sale.paid)} of ${money(sale.total)}`) : null),
      h('div.methods', { role: 'tablist' }, methods.map((mt) => h(`button.method${method === mt.id ? '.active' : ''}`, {
        role: 'tab', disabled: !!watching, onclick: () => { method = mt.id; draw(); },
      }, icon({ cash: 'wallet', card: 'receipt', qr: 'qr', esewa: 'wallet', khalti: 'wallet', stripe: 'link' }[mt.id] || 'wallet', 18), mt.label))),
      h('div.method-panel', watching ? waitingPanel() : panelFor(methods.find((x) => x.id === method))),
      !watching && getState().boot.settings.checkout.allowPostpone && !(sale && sale.postponed) ? payLaterBlock() : null);
  }

  function payLaterBlock() {
    const cfg = getState().boot.settings.checkout;
    const def = new Date(Date.now() + cfg.defaultDueDays * 86400_000).toISOString().slice(0, 10);
    const dueInput = h('input.input', { type: 'date', value: def, 'aria-label': 'Due date' });
    const cust = cart?.customer || {};
    const needs = cfg.postponeRequiresCustomer && !(sale ? sale.customer_id : cust.id);
    return h('div.pay-later',
      h('div', h('b', 'Pay later'), h('small.muted', needs ? ' — pick a saved customer on the bill first' : ' — issue the bill now, collect the payment by the due date')),
      h('div.row-actions', dueInput, h('button.btn', { disabled: needs, onclick: () => run(async () => {
        const s = await ensureSale();
        sale = await post(`/api/sales/${s.id}/postpone`, { dueDate: dueInput.value });
        emitExt('sale:complete', sale);
        m.close();
      }) }, icon('calendar', 16), 'Pay later')));
  }

  function amountField() {
    return h('label.field.inline', h('span', 'Amount (split payment)'), h('input.input.amt', { type: 'number', step: 'any', min: 0, value: toMajor(due()), name: 'amount' }));
  }
  const readAmount = () => {
    const v = body.querySelector('input[name=amount]')?.value;
    return v ? Number(v) : toMajor(due());
  };

  function panelFor(mt) {
    if (!mt) return h('p', 'No payment methods are enabled. Turn some on in Connectors.');
    if (mt.id === 'cash') {
      const tendered = h('input.input.big', { type: 'number', step: 'any', min: 0, value: toMajor(due()), 'aria-label': 'Cash received' });
      const change = h('div.change');
      const upd = () => { const c = toMinor(tendered.value) - due(); change.replaceChildren(c >= 0 ? h('span', 'Change ', h('b', money(c))) : h('span.warn', `Short by ${money(-c)} (records partial payment)`)); };
      tendered.addEventListener('input', upd); upd();
      tendered.addEventListener('keydown', (e) => { if (e.key === 'Enter') pay(); });
      const pay = () => run(async () => {
        const s = await ensureSale();
        const r = await post(`/api/sales/${s.id}/payments`, { method: 'cash', tendered: Number(tendered.value) });
        sale = r.sale; sale.status === 'paid' ? success() : draw();
      });
      setTimeout(() => { tendered.focus(); tendered.select(); }, 20);
      return h('div',
        h('label.field', h('span', 'Cash received'), tendered),
        h('div.chips.tenders', quickTenders(due()).map((v) => h('button.chip', { onclick: () => { tendered.value = toMajor(v); upd(); } }, money(v)))),
        change,
        h('button.btn.primary.block', { onclick: pay }, icon('check'), 'Complete sale'));
    }
    if (mt.kind === 'manual') {
      const ref = h('input.input', { placeholder: mt.id === 'card' ? 'Approval code / last 4 digits (optional)' : 'Transaction ID (optional)' });
      const qr = mt.id === 'qr' ? qrBlock(mt) : null;
      return h('div', qr, amountField(), h('label.field', h('span', 'Reference'), ref),
        h('p.hint', mt.id === 'qr' ? 'Ask the customer to scan, then confirm once the money shows in your bank/wallet app. A signed webhook can confirm it automatically.' : 'Charge the card on your terminal, then confirm.'),
        h('div.row-actions',
          mt.id === 'qr' ? h('button.btn', { onclick: () => run(async () => {
            const s = await ensureSale();
            const r = await post(`/api/sales/${s.id}/payments`, { method: 'qr', amount: readAmount(), reference: ref.value });
            watching = r.payment; sale = r.sale; draw();
          }) }, icon('refresh', 16), 'Wait for webhook') : null,
          h('button.btn.primary', { onclick: () => run(async () => {
            const s = await ensureSale();
            const r = await post(`/api/sales/${s.id}/payments`, { method: mt.id, amount: readAmount(), reference: ref.value, confirm: true });
            sale = r.sale; sale.status === 'paid' ? success() : draw();
          }) }, icon('check'), 'Payment received')));
    }
    // Online providers
    return h('div', amountField(),
      h('p.hint', {
        esewa: 'Opens eSewa in a new window on this PC. The POS checks eSewa for the result automatically.',
        khalti: 'Creates a Khalti payment link. Show the QR to the customer or open it here. Verified automatically.',
        stripe: 'Creates a Stripe Checkout link. Show the QR or open it here. Verified automatically.',
      }[mt.id]),
      h('button.btn.primary.block', { onclick: () => run(async () => {
        const s = await ensureSale();
        const popup = mt.id === 'esewa' ? window.open('', 'pos-pay', 'width=520,height=760') : null;
        const r = await post(`/api/sales/${s.id}/payments`, { method: mt.id, amount: readAmount() });
        watching = r.payment; sale = r.sale;
        if (r.form && popup) postForm(popup, r.form);
        draw();
      }) }, icon('link'), `Pay with ${mt.label}`));
  }

  function qrBlock(mt) {
    if (mt.imageUrl) return h('div.qr-box', h('img', { src: mt.imageUrl, alt: 'Payment QR' }));
    if (mt.payload) return h('div.qr-box', h('img', { src: `/api/qr.svg?text=${encodeURIComponent(mt.payload)}`, alt: 'Payment QR' }));
    return h('p.hint', 'Tip: add your Fonepay/bank QR in Connectors to show it here.');
  }

  function waitingPanel() {
    const w = watching;
    return h('div.waiting',
      h('div.spinner', { 'aria-hidden': 'true' }),
      h('h4', `Waiting for ${w.method} payment of ${money(w.amount)}`),
      w.pay_url ? h('div.qr-box', h('img', { src: `/api/qr.svg?text=${encodeURIComponent(w.pay_url)}`, alt: 'Scan to pay' })) : null,
      w.pay_url ? h('a.btn', { href: w.pay_url, target: '_blank', rel: 'noopener noreferrer' }, icon('link', 16), 'Open payment page') : null,
      h('div.row-actions',
        h('button.btn', { onclick: () => run(verifyNow) }, icon('refresh', 16), 'Check now'),
        w.method === 'qr' ? h('button.btn.primary', { onclick: () => run(async () => { await post(`/api/payments/${w.id}/confirm`, {}); }) }, icon('check', 16), 'Confirm manually') : null,
        h('button.btn.danger', { onclick: () => run(async () => { await post(`/api/payments/${w.id}/cancel`); watching = null; sale = await get(`/api/sales/${sale.id}`); draw(); }) }, 'Cancel payment')));
  }

  let shown = false;
  function success() {
    if (shown) return;
    shown = true;
    watching = null;
    chime('ok');
    emitExt('sale:complete', sale);
    showPaid({ shop: getState().boot.settings.business.name, total: money(sale.total), change: sale.change_due ? money(sale.change_due) : null });
    const link = `${getState().boot.baseUrl}/b/${sale.public_token}`;
    body.replaceChildren(h('div.success',
      h('div.big-check', icon('check', 48)),
      h('h3', 'Paid'), h('div.co-due', money(sale.total)),
      sale.change_due ? h('div.change-big', 'Change: ', h('b', money(sale.change_due))) : null,
      h('p.muted', `${sale.invoice_no} · ${sale.payment_method}`),
      h('div.row-actions',
        h('button.btn', { onclick: () => printReceipt(sale) }, icon('printer', 16), 'Print receipt'),
        h('button.btn', { onclick: () => navigator.clipboard.writeText(link).then(() => toast('Bill link copied', 'success'), () => modal({ title: 'Copy this link', body: h('pre.code.select', link) })) }, icon('link', 16), 'Copy e-bill link'),
        h('button.btn.primary', { onclick: () => m.close() }, icon('plus', 16), 'New sale (Enter)'))));
    const onEnter = (e) => { if (e.key === 'Enter') { document.removeEventListener('keydown', onEnter); m.close(); } };
    setTimeout(() => document.addEventListener('keydown', onEnter), 300);
    off.push(() => document.removeEventListener('keydown', onEnter));
  }

  async function run(fn) {
    const btns = body.querySelectorAll('button');
    btns.forEach((b) => { b.dataset.wasDisabled = b.disabled; b.disabled = true; });
    try { await fn(); } catch (e) { errorToast(e); chime('bad'); draw(); }
    finally { btns.forEach((b) => { if (b.isConnected) b.disabled = b.dataset.wasDisabled === 'true'; }); }
  }

  draw();
}

function postForm(win, { action, fields }) {
  const doc = win.document;
  doc.title = 'Redirecting to eSewa…';
  const form = doc.createElement('form');
  form.method = 'POST'; form.action = action;
  for (const [k, v] of Object.entries(fields)) {
    const i = doc.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; form.append(i);
  }
  doc.body.append(form);
  form.submit();
}

/** Print via the configured receipt printer, or the browser's printable receipt. */
export async function printReceipt(sale) {
  const p = getState().boot.settings.printer || {};
  if (p.mode && p.mode !== 'browser') {
    try { await post(`/api/print/sale/${sale.id}`); toast('Sent to the receipt printer', 'success'); return; }
    catch (e) { toast(`${e.message} — opening browser print instead`, 'warn', 5000); }
  }
  window.open(`/b/${sale.public_token}?print=1&w=${p.paper || '80'}`, '_blank', 'width=420,height=720');
}
