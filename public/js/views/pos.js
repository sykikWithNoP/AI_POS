// POS: Sell screen (catalog grid + live cart) and the Items manager tab.
import { h, icon, money, toMinor, toMajor, toast, errorToast, modal, field, promptDialog, confirmDialog, empty, debounce } from '../ui.js';
import { dispatch, getState, subscribe } from '../store.js';
import { get } from '../api.js';
import { calculateBill } from '/shared/billing.js';
import { cartForExtensions as cartForExt, emitExt, ruleDiscounts, extensionButtons, clickExtensionButton, onRulesUpdate, settleRules, checkBeforeSale } from '../extensions.js';
import { openCheckout } from './checkout.js';
import { showCart, openCustomerDisplay } from '../display-link.js';
import { device } from '../device.js';
import { renderItemsManager } from './items.js';
import { renderCustomers, pickCustomerDialog } from './customers.js';
import { shiftChip } from './shift.js';
import { onScan, cameraButton } from '../scanner.js';
import { post } from '../api.js';

let category = '';
let query = '';

export async function loadItems() {
  const items = await get('/api/items');
  dispatch({ type: 'items', items });
}

/** Live totals: same engine as the server, so the number on screen is the number billed. */
export function cartTotals(cart = getState().cart) {
  const { tax, loyalty } = getState().boot.settings;
  const rules = ruleDiscounts(cart);
  const redeemAmount = cart.redeemPoints ? toMinor(cart.redeemPoints * loyalty.pointValue) : 0;
  const opts = {
    taxRate: tax.rate, taxInclusive: tax.inclusive, serviceChargeRate: tax.serviceChargeRate,
    cartDiscount: cart.cartDiscount, extraDiscounts: [...rules.map((r) => r.amount), redeemAmount],
  };
  // Mirrors the server: member discount applies to goods (not the membership fee) after other discounts.
  const ms = cart.customer?.membership;
  let member = null;
  if (ms && ms.discountPercent > 0) {
    const pre = calculateBill(cart.lines, opts);
    const base = pre.lines.filter((l) => !l.membershipPlanId).reduce((a, l) => a + l.net - l.cartDiscountShare, 0);
    const amount = Math.round((base * ms.discountPercent) / 100);
    if (amount > 0) { member = { name: ms.name, percent: ms.discountPercent, amount }; opts.extraDiscounts.push(amount); }
  }
  const bill = calculateBill(cart.lines, opts);
  return { ...bill, rules, member, redeemAmount };
}

export function renderPos(root, { sub = 'sell', actions } = {}) {
  actions?.append(shiftChip());
  root.replaceChildren();
  if (sub === 'customers') {
    const box = h('div.items-wrap');
    root.append(box);
    renderCustomers(box);
    return () => {};
  }
  if (sub === 'items') {
    const box = h('div.items-wrap');
    root.append(box);
    renderItemsManager(box, { onChange: loadItems });
    return () => {};
  }
  return renderSell(root);
}

// Layout: items top-left · member search top-right above the bill · action bar (Membership…) bottom-left.
function renderSell(root) {
  const search = h('input.input.search-input', { type: 'search', placeholder: device.keyboard ? 'Search or scan barcode…  (F2)' : 'Search or scan barcode…', value: query, 'aria-label': 'Search items', autocomplete: 'off' });
  const chips = h('div.chips');
  const grid = h('div.product-grid');
  const cartBox = h('div.cart-body');
  const tabs = h('div.session-tabs', { role: 'tablist', 'aria-label': 'Open bills' });
  const toolbar = h('div.pos-toolbar', h('div.search-wrap', icon('search', 18), search), cameraButton(), h('div.ext-buttons'));
  const actionBar = h('div.action-bar',
    h('button.btn.member-btn', { onclick: membershipAction, title: 'Sell or manage a membership' }, '★', 'Membership'),
    h('button.btn', { onclick: addOpenItem }, icon('plus', 16), 'Custom item'),
    h('button.btn', { onclick: () => discountDialog(getState().cart.cartDiscount, (d) => dispatch({ type: 'cart/discount', discount: d })) }, icon('tag', 16), 'Discount'),
    h('button.btn', { onclick: () => import('./shift.js').then((m) => m.drawerDialog()) }, icon('wallet', 16), 'Cash drawer'),
    device.kind === 'computer' && !device.app ? h('button.btn', { title: 'Open a window for a screen facing the customer', onclick: () => { if (!openCustomerDisplay()) toast('Allow pop-ups for the POS to open the customer screen', 'warn'); } }, icon('grid', 16), 'Customer screen') : null);
  const left = h('section.catalog', toolbar, chips, grid, actionBar);
  const right = h('aside.cart', { 'aria-label': 'Current bill' }, memberSearch(), tabs, cartBox);
  root.append(h('div.sell', left, right));

  const drawChips = () => {
    const cats = [...new Set(getState().items.map((i) => i.category))];
    chips.replaceChildren(
      h(`button.chip${!category ? '.active' : ''}`, { onclick: () => { category = ''; drawChips(); drawGrid(); } }, 'All'),
      ...cats.map((c) => h(`button.chip${category === c ? '.active' : ''}`, { onclick: () => { category = c; drawChips(); drawGrid(); } }, c)));
  };

  const visible = () => {
    const q = query.trim().toLowerCase();
    return getState().items.filter((i) => (!category || i.category === category) &&
      (!q || i.name.toLowerCase().includes(q) || i.sku?.toLowerCase() === q || i.barcode === query.trim()));
  };

  const drawGrid = () => {
    const list = visible();
    if (!getState().items.length) { grid.replaceChildren(empty('No items yet. Add your catalog in the Items tab.', 'box')); return; }
    grid.replaceChildren(...list.map((i) => h('button.product', {
      onclick: () => addToCart(i), style: i.color ? { '--tint': i.color } : undefined,
      title: `${i.name} — ${money(i.price)}`,
    },
    h('span.p-emoji', i.emoji || i.name.slice(0, 2).toUpperCase()),
    h('span.p-name', i.name),
    h('span.p-price', money(i.price), i.options?.length ? h('small.muted', ' +options') : null),
    i.stock !== null && i.stock !== undefined ? h(`span.p-stock${i.stock <= 0 ? '.out' : i.stock <= 5 ? '.low' : ''}`, `${i.stock} ${i.unit}`) : null)));
    if (!list.length) grid.append(empty('No matches'));
  };

  const drawExtButtons = () => {
    toolbar.querySelector('.ext-buttons').replaceChildren(...extensionButtons().map((b) =>
      h('button.btn.sm', { title: `From extension: ${b.ext}`, onclick: () => clickExtensionButton(b.id) }, b.icon ? `${b.icon} ` : '', b.label)));
  };

  const drawTabs = () => {
    const { sessions, active } = getState();
    tabs.replaceChildren(
      ...sessions.map((x) => {
        const n = x.cart.lines.reduce((a, l) => a + l.qty, 0);
        return h(`div.session-tab${x.id === active ? '.active' : ''}`, { role: 'tab', 'aria-selected': x.id === active },
          h('button.st-main', { onclick: () => dispatch({ type: 'session/switch', id: x.id }), ondblclick: async () => { const l = await promptDialog('Name this bill (e.g. Table 4)', x.label, { title: 'Rename' }); if (l) dispatch({ type: 'session/rename', id: x.id, label: l }); }, title: 'Double-click to rename' },
            h('span', x.label), x.cart.customer?.name ? h('small', x.cart.customer.name) : null, n ? h('span.st-count', n) : null),
          sessions.length > 1 ? h('button.st-close', { 'aria-label': `Close ${x.label}`, onclick: () => closeSession(x) }, icon('x', 12)) : null);
      }),
      h('button.session-add', { onclick: () => dispatch({ type: 'session/new' }), title: 'Start another bill while this one stays open', 'aria-label': 'New bill' }, icon('plus', 14), 'New'));
  };

  search.addEventListener('input', debounce(() => { query = search.value; drawGrid(); }, 80));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    const exact = getState().items.find((i) => i.barcode === q || (i.sku && i.sku.toLowerCase() === q.toLowerCase()));
    const list = visible();
    const pick = exact || (list.length === 1 ? list[0] : null);
    if (pick) { addToCart(pick); search.value = ''; query = ''; drawGrid(); }
  });

  drawChips(); drawGrid(); drawExtButtons(); drawTabs(); drawCart(cartBox);
  onRulesUpdate(() => { if (cartBox.isConnected) drawCart(cartBox); });
  const onExtReload = () => drawExtButtons();
  window.addEventListener('pos:extensions-reloaded', onExtReload);
  const unsub = subscribe((st, prev) => {
    if (st.cart !== prev.cart) drawCart(cartBox);
    if (st.sessions !== prev.sessions || st.active !== prev.active) drawTabs();
    if (st.items !== prev.items) { drawChips(); drawGrid(); }
  });
  const onKey = (e) => {
    if (e.key === 'F2') { e.preventDefault(); search.focus(); search.select(); }
    if (e.key === 'F3') { e.preventDefault(); document.querySelector('.member-search input')?.focus(); }
    if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); checkout(); }
  };
  document.addEventListener('keydown', onKey);
  // Scanner: works from anywhere on the sell screen.
  const offScan = onScan((code) => {
    const item = getState().items.find((i) => i.barcode === code || (i.sku && i.sku.toLowerCase() === code.toLowerCase()));
    if (item) { addToCart(item); return; }
    toast(`Unknown barcode ${code}`, 'warn', 6000);
  });
  setTimeout(() => search.focus(), 0);
  return () => { unsub(); offScan(); document.removeEventListener('keydown', onKey); window.removeEventListener('pos:extensions-reloaded', onExtReload); };
}

async function closeSession(x) {
  if (x.cart.lines.length && !(await confirmDialog(`Close ${x.label}? Its ${x.cart.lines.length} line(s) will be discarded.`, { okLabel: 'Close bill', danger: true }))) return;
  dispatch({ type: 'session/close', id: x.id });
}

/** Top-right: find a member/customer and attach them to the current bill. */
function memberSearch() {
  const input = h('input.input', { type: 'search', placeholder: device.keyboard ? 'Search members / customers…  (F3)' : 'Search members / customers…', 'aria-label': 'Search members', autocomplete: 'off' });
  const results = h('ul.member-results', { hidden: true });
  const current = h('div.member-current');
  const wrap = h('div.member-search', h('div.search-wrap', icon('user', 18), input), results, current);
  const pick = (c) => { dispatch({ type: 'cart/customer', customer: c, replace: true }); input.value = ''; results.hidden = true; };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { results.hidden = true; return; }
    try {
      const list = await get(`/api/customers?limit=6&q=${encodeURIComponent(q)}`);
      results.replaceChildren(
        ...list.map((c) => h('li', h('button.pick', { onmousedown: (e) => { e.preventDefault(); pick(c); } },
          h('span', h('b', c.name), c.membership ? h('span.member-tag', { style: c.membership.color ? { background: c.membership.color } : undefined }, `★ ${c.membership.name}`) : null),
          h('small.muted', [c.phone, `${c.points} pts`].filter(Boolean).join(' · '))))),
        h('li', h('button.pick.add', { onmousedown: (e) => { e.preventDefault(); results.hidden = true; customerDialog(); } }, icon('plus', 14), list.length ? 'More options / new customer' : `Add "${q}"`)));
      results.hidden = false;
    } catch (e) { errorToast(e); }
  }, 150);
  input.addEventListener('input', run);
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; results.hidden = true; } });
  const drawCurrent = () => {
    const c = getState().cart.customer || {};
    current.replaceChildren(c.name
      ? h('div.member-card', { style: c.membership?.color ? { '--tint': c.membership.color } : undefined },
        h('button.mc-main', { onclick: customerDialog },
          h('b', c.name), c.membership ? h('span.member-tag', { style: c.membership.color ? { background: c.membership.color } : undefined }, `★ ${c.membership.name} · ${c.membership.discountPercent}% off`) : null,
          h('small.muted', [c.id ? `${c.points ?? 0} pts` : null, c.pan ? `PAN ${c.pan}` : null, c.outstanding ? `owes ${money(c.outstanding)}` : null].filter(Boolean).join(' · ') || 'Walk-in')),
        h('button.icon-btn.sm', { 'aria-label': 'Remove customer', onclick: () => dispatch({ type: 'cart/customer', customer: {}, replace: true }) }, icon('x', 14)))
      : h('button.btn.sm.ghost.walkin', { onclick: customerDialog }, icon('user', 14), 'Walk-in customer'));
  };
  drawCurrent();
  const unsub = subscribe((st, prev) => { if (!wrap.isConnected) return unsub(); if (st.cart.customer !== prev.cart.customer) drawCurrent(); });
  return wrap;
}

/** Bottom-left Membership button: sell a plan to the current customer (or pick one first). */
function membershipAction() {
  const plans = getState().boot.plans;
  if (!plans.length) { toast('Create membership tiers in Settings → Memberships first', 'warn'); location.hash = '#/settings/memberships'; return; }
  const c = getState().cart.customer;
  if (!c?.id) { toast('Pick the member first', 'info'); pickCustomerDialog(c, (cust) => { dispatch({ type: 'cart/customer', customer: cust, replace: true }); if (cust.id) membershipAction(); }); return; }
  const m = modal({
    title: `Membership for ${c.name}`,
    body: h('div', c.membership ? h('p.hint', `Currently ★ ${c.membership.name} (${c.membership.until ? 'until ' + new Date(c.membership.until).toLocaleDateString() : 'lifetime'}). Choosing the same tier renews it.`) : null,
      h('div.plan-list', plans.map((p) => h('button.plan', { style: p.color ? { '--tint': p.color } : undefined, onclick: () => {
        dispatch({ type: 'cart/add', item: { id: null, membershipPlanId: p.id, name: `Membership: ${p.name}`, price: p.fee, category: 'Membership', emoji: '★' } });
        toast(`${p.name} added to the bill — activates when paid`, 'success');
        m.close();
      } }, h('b', `★ ${p.name}`), h('span', `${p.discount_percent}% off · ${p.points_multiplier}× points`), h('small.muted', `${p.fee ? money(p.fee) : 'Free'} · ${p.duration_days ? `${p.duration_days} days` : 'lifetime'}`), p.perks ? h('small', p.perks) : null)))),
  });
}

function addToCart(item) {
  if (item.options?.length) return optionsPicker(item);
  dispatch({ type: 'cart/add', item });
  emitExt('cart:change', getState().cart);
}

/** Variants & add-ons: pick choices; the price shown is recomputed by the server at checkout. */
function optionsPicker(item) {
  const picked = new Map(); // group -> Set(choice)
  for (const g of item.options) picked.set(g.name, new Set(g.required && !g.multi ? [g.choices[0].name] : []));
  const priceEl = h('b');
  const calc = () => {
    let p = item.price;
    for (const g of item.options) for (const c of g.choices) if (picked.get(g.name).has(c.name)) p += c.price;
    priceEl.textContent = money(p);
    return p;
  };
  const groups = item.options.map((g) => h('fieldset.opt-group',
    h('legend', g.name, g.required ? h('small.muted', ' · required') : null, g.multi ? h('small.muted', ' · pick any') : null),
    h('div.chips', g.choices.map((c) => {
      const btn = h(`button.chip${picked.get(g.name).has(c.name) ? '.active' : ''}`, { type: 'button', onclick: () => {
        const set = picked.get(g.name);
        if (g.multi) set.has(c.name) ? set.delete(c.name) : set.add(c.name);
        else { if (set.has(c.name) && !g.required) set.clear(); else { set.clear(); set.add(c.name); } }
        for (const b of btn.parentElement.children) b.classList.toggle('active', set.has(b.dataset.choice));
        calc();
      } }, c.name, c.price ? h('small', ` ${c.price > 0 ? '+' : '−'}${money(Math.abs(c.price))}`) : null);
      btn.dataset.choice = c.name;
      return btn;
    }))));
  calc();
  modal({
    title: item.name, body: h('div.form-grid', ...groups, h('div.t-row.grand', h('span', 'Price'), priceEl)),
    actions: [{ label: 'Add to bill', primary: true, onClick: (close) => {
      for (const g of item.options) if (g.required && !picked.get(g.name).size) return toast(`Choose ${g.name}`, 'warn');
      const options = [];
      const labels = [];
      for (const g of item.options) for (const c of g.choices) if (picked.get(g.name).has(c.name)) { options.push({ group: g.name, choice: c.name }); labels.push(c.name); }
      dispatch({ type: 'cart/add', item, options, unitPrice: calc(), label: labels.length ? `${item.name} (${labels.join(', ')})` : item.name });
      emitExt('cart:change', getState().cart);
      close();
    } }],
  });
}

async function addOpenItem() {
  const name = await promptDialog('Item name', 'Misc', { title: 'Custom item' });
  if (!name) return;
  const price = await promptDialog('Price', '', { title: 'Custom item', type: 'number' });
  if (!price || Number(price) <= 0) return;
  dispatch({ type: 'cart/add', item: { id: null, name, price: toMinor(price), category: 'Custom' } });
}

function drawCart(box) {
  const { cart } = getState();
  const t = cartTotals(cart);
  const c = cart.customer || {};
  const { tax: taxCfg, business } = getState().boot.settings;
  showCart({
    shop: business.name,
    lines: cart.lines.map((l) => { const calc = t.lines.find((x) => x.key === l.key); return { qty: l.qty, name: l.name, total: money(calc ? calc.gross - calc.lineDiscount : l.unitPrice * l.qty) }; }),
    rows: [['Subtotal', money(t.subtotal)], ...(t.discount > 0 ? [['Discount', `−${money(t.discount)}`]] : []), ...(t.tax > 0 ? [[taxCfg.label, money(t.tax)]] : [])],
    total: money(t.total), member: t.member ? `${t.member.name} member — ${t.member.percent}% off` : null,
  });

  const lines = cart.lines.length ? h('ul.lines', cart.lines.map((l) => {
    const calc = t.lines.find((x) => x.key === l.key);
    return h('li.line',
      h('div.l-main',
        h('div.l-name', l.emoji ? `${l.emoji} ` : '', l.name),
        h('div.l-sub', `${money(l.unitPrice)} × ${l.qty}`, l.discount ? h('span.l-disc', ` · −${l.discount.type === 'percent' ? l.discount.value + '%' : money(l.discount.value)}`) : null)),
      h('div.stepper',
        h('button.icon-btn.sm', { 'aria-label': `Decrease ${l.name}`, onclick: () => dispatch({ type: 'cart/qty', key: l.key, qty: l.qty - 1 }) }, icon('minus', 14)),
        h('input.qty', { type: 'number', min: 0, step: 'any', value: l.qty, 'aria-label': `Quantity of ${l.name}`, onchange: (e) => dispatch({ type: 'cart/qty', key: l.key, qty: Number(e.target.value) || 0 }) }),
        h('button.icon-btn.sm', { 'aria-label': `Increase ${l.name}`, onclick: () => dispatch({ type: 'cart/qty', key: l.key, qty: l.qty + 1 }) }, icon('plus', 14))),
      h('div.l-total', money(calc ? calc.gross - calc.lineDiscount : l.unitPrice * l.qty)),
      h('div.l-actions',
        h('button.icon-btn.sm', { title: 'Line discount', 'aria-label': 'Line discount', onclick: () => discountDialog(l.discount, (d) => dispatch({ type: 'cart/line', key: l.key, patch: { discount: d } })) }, icon('tag', 14)),
        h('button.icon-btn.sm', { title: 'Remove', 'aria-label': `Remove ${l.name}`, onclick: () => dispatch({ type: 'cart/remove', key: l.key }) }, icon('trash', 14))));
  })) : h('div.cart-empty', icon('cart', 36), h('p', 'Cart is empty'), h('small', 'Tap items or scan a barcode'));

  const row = (label, value, cls = '') => h(`div.t-row${cls}`, h('span', label), h('b', value));
  const totals = h('div.totals',
    row('Subtotal', money(t.subtotal)),
    (() => { // manual line/cart discounts only; rules, points and member pricing get their own rows
      const manual = t.discount - t.rules.reduce((a, r) => a + r.amount, 0) - (t.redeemAmount || 0) - (t.member?.amount || 0);
      return manual > 0 ? row('Discount', `−${money(manual)}`, '.disc') : null;
    })(),
    ...t.rules.map((r) => h('div.t-row.rule', h('span', '✨ ' + r.label), h('b', `−${money(r.amount)}`))),
    t.redeemAmount ? h('div.t-row.rule', h('span', `🎁 ${cart.redeemPoints} points`), h('b', `−${money(t.redeemAmount)}`)) : null,
    t.member ? h('div.t-row.rule', h('span', `★ ${t.member.name} member ${t.member.percent}%`), h('b', `−${money(t.member.amount)}`)) : null,
    t.serviceCharge ? row('Service charge', money(t.serviceCharge)) : null,
    row(`${getState().boot.settings.tax.label}${getState().boot.settings.tax.inclusive ? ' (incl.)' : ''}`, money(t.tax)),
    row('Total', money(t.total), '.grand'));

  box.replaceChildren(
    h('div.cart-head',
      h('span.muted', `${t.itemCount} item${t.itemCount === 1 ? '' : 's'}`),
      h('div.cart-head-actions',
        h('button.icon-btn', { title: 'Clear this bill', 'aria-label': 'Clear bill', disabled: !cart.lines.length, onclick: () => dispatch({ type: 'cart/clear' }) }, icon('trash', 18)))),
    lines,
    h('div.cart-foot',
      h('div.cart-tools',
        h('button.btn.sm.ghost', { onclick: () => discountDialog(cart.cartDiscount, (d) => dispatch({ type: 'cart/discount', discount: d })) }, icon('tag', 14), cart.cartDiscount ? 'Edit discount' : 'Discount'),
        h('button.btn.sm.ghost', { onclick: notesDialog }, icon('edit', 14), cart.notes ? 'Edit note' : 'Note'),
        c.id && getState().boot.settings.loyalty.enabled ? h('button.btn.sm.ghost', { onclick: redeemDialog }, '🎁', cart.redeemPoints ? `${cart.redeemPoints} pts` : 'Points') : null,
      ),
      totals,
      h('button.btn.primary.pay', { disabled: !cart.lines.length, onclick: checkout }, h('span', 'Charge'), h('b', money(t.total)), device.keyboard ? h('kbd', 'F9') : null)));
}

let checkingOut = false;
async function checkout() {
  const { cart } = getState();
  if (!cart.lines.length || checkingOut) return;
  checkingOut = true;
  try {
    await settleRules(cart);                 // extension discounts are current
    const t = cartTotals(cart);
    const blocked = await checkBeforeSale({ ...cartForExt(cart), total: toMajor(t.total) });
    if (blocked) { toast(blocked, 'warn'); return; }
    openCheckout(cart, t);
  } finally { checkingOut = false; }
}

function discountDialog(current, apply) {
  const type = h('select.input', h('option', { value: 'percent', selected: current?.type === 'percent' }, 'Percent %'), h('option', { value: 'amount', selected: current?.type === 'amount' }, 'Amount'));
  const value = h('input.input', { type: 'number', min: 0, step: 'any', value: current ? (current.type === 'amount' ? toMajor(current.value) : current.value) : '' });
  const quick = h('div.chips', [5, 10, 15, 20].map((p) => h('button.chip', { type: 'button', onclick: () => { type.value = 'percent'; value.value = p; } }, `${p}%`)));
  modal({
    title: 'Discount', body: h('div.form-grid', field('Type', type), field('Value', value), quick),
    actions: [
      { label: 'Remove', onClick: (c) => { apply(null); c(); } },
      { label: 'Apply', primary: true, onClick: (c) => {
        const v = Number(value.value);
        if (!v || v < 0) { apply(null); return c(); }
        apply(type.value === 'percent' ? { type: 'percent', value: Math.min(100, v) } : { type: 'amount', value: toMinor(v) });
        c();
      } }],
  });
}

function customerDialog() {
  pickCustomerDialog(getState().cart.customer, (customer) => dispatch({ type: 'cart/customer', customer, replace: true }));
}

function redeemDialog() {
  const { cart, boot } = getState();
  const L = boot.settings.loyalty;
  const have = cart.customer.points || 0;
  const input = h('input.input', { type: 'number', min: 0, step: 1, value: cart.redeemPoints || Math.min(have, L.minRedeem) });
  modal({
    title: 'Redeem loyalty points',
    body: h('div.form-grid', h('p', `${cart.customer.name} has `, h('b', `${have} points`), ` (1 point = ${money(toMinor(L.pointValue))}, minimum ${L.minRedeem}).`), field('Points to redeem', input)),
    actions: [
      { label: 'Remove', onClick: (c) => { dispatch({ type: 'cart/redeem', points: 0 }); c(); } },
      { label: 'Apply', primary: true, onClick: (c) => {
        const p = Math.floor(Number(input.value) || 0);
        if (p && p < L.minRedeem) return toast(`Minimum is ${L.minRedeem} points`, 'warn');
        if (p > have) return toast(`Only ${have} points available`, 'warn');
        dispatch({ type: 'cart/redeem', points: p }); c();
      } }],
  });
}

function notesDialog() {
  const ta = h('textarea.input', { rows: 3, value: getState().cart.notes || '', placeholder: 'Shown on the bill' });
  modal({ title: 'Bill note', body: ta, actions: [{ label: 'Save', primary: true, onClick: (c) => { dispatch({ type: 'cart/notes', notes: ta.value }); c(); } }] });
}
