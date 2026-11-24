// Welcome wizard: the first thing a new owner sees after creating the PIN and owner account.
// Five short questions, then a quick tour of the selling screen. Everything can be changed later
// in Settings and Connectors; "Skip" leaves the defaults.
import { h, icon, toast, errorToast } from './ui.js';
import { get, post } from './api.js';
import { dispatch } from './store.js';
import { BRAND } from '/shared/brand.js';

const TYPES = [
  { id: 'shop', icon: 'box', label: 'Shop / retail', hint: 'Groceries, clothes, pharmacy, hardware…' },
  { id: 'restaurant', icon: 'cart', label: 'Restaurant / café', hint: 'Tables, kitchen, service charge' },
  { id: 'services', icon: 'user', label: 'Services', hint: 'Salon, repairs, clinic, classes…' },
];

export function runWelcome(boot) {
  return new Promise((resolve) => {
    const biz = boot.settings.business;
    const ans = {
      business: { name: biz.name === 'My Shop' ? '' : biz.name, address: biz.address || '', phone: biz.phone || '', pan: biz.pan || '' },
      businessType: 'shop', vat: true, pricesIncludeTax: false, serviceCharge: false,
      products: 'sample', items: [{ name: '', price: '', category: '' }],
      methods: { cash: true, card: true, qr: true, esewa: false, khalti: false, stripe: false },
    };
    let step = 0;
    const body = h('div.wz-body');
    const dots = h('ol.wz-dots');
    const back = h('button.btn', { type: 'button', onclick: () => { step--; draw(); } }, icon('chevronLeft', 16), 'Back');
    const next = h('button.btn.primary', { type: 'button', onclick: () => go() });
    const skip = h('button.btn.ghost.sm', { type: 'button', onclick: async () => { try { await post('/api/onboarding/skip'); } catch { /* ignore */ } overlay.remove(); resolve(false); } }, 'Skip setup — I\'ll do it later');
    const overlay = h('div.wizard', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome setup' },
      h('div.wz-card', h('header.wz-head', h('div.brand-mark', icon('cart', 20)), h('div', h('h2', `Welcome to ${BRAND.name}! Let's set up your till`), h('p.muted', 'About two minutes. You can change everything later.'))), dots, body,
        h('footer.wz-foot', skip, h('div.spacer'), back, next)));

    const input = (obj, key, attrs = {}) => h('input.input', { value: obj[key] ?? '', oninput: (e) => { obj[key] = e.target.value; }, ...attrs });
    const choice = (on, label, hint, onclick, ic) => h(`button.wz-choice${on ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(on), onclick }, ic ? icon(ic, 22) : null, h('b', label), hint ? h('small', hint) : null);
    const check = (obj, key, label, hint, disabled) => h('label.toggle', h('input', { type: 'checkbox', checked: !!obj[key], disabled, onchange: (e) => { obj[key] = e.target.checked; } }), h('span.track'), h('span', label, hint ? h('small.muted', ` — ${hint}`) : null));

    const STEPS = [
      { title: 'Your shop', draw: () => [
        h('p', 'This is printed on every bill.'),
        h('div.form-grid.two',
          h('label.field', h('span', 'Shop name *'), input(ans.business, 'name', { placeholder: 'e.g. Himalayan Café', autofocus: true })),
          h('label.field', h('span', 'Phone'), input(ans.business, 'phone', { inputMode: 'tel' })),
          h('label.field', h('span', 'Address'), input(ans.business, 'address')),
          h('label.field', h('span', 'PAN / VAT number'), input(ans.business, 'pan', { inputMode: 'numeric', placeholder: 'Leave empty if you don\'t have one' }))),
      ], check: () => (ans.business.name.trim() ? null : 'Please type your shop name') },
      { title: 'What kind of business?', draw: () => [
        h('p', 'This picks sensible defaults and sample products.'),
        h('div.wz-choices', TYPES.map((t) => choice(ans.businessType === t.id, t.label, t.hint, () => { ans.businessType = t.id; draw(); }, t.icon))),
        ans.businessType === 'restaurant' ? check(ans, 'serviceCharge', 'Add 10% service charge', 'common for restaurants') : null,
      ] },
      { title: 'Tax', draw: () => [
        h('p', 'Are you registered for VAT?'),
        h('div.wz-choices',
          choice(ans.vat, 'Yes, VAT-registered', '13% VAT is added to bills', () => { ans.vat = true; draw(); }, 'shield'),
          choice(!ans.vat, 'No', 'Bills show no VAT', () => { ans.vat = false; draw(); }, 'x')),
        ans.vat ? check(ans, 'pricesIncludeTax', 'My prices already include VAT', 'otherwise VAT is added on top') : null,
        ans.vat ? h('p.hint', 'Reporting bills to IRD can be switched on later under Overview › IRD. It starts in practice mode, so nothing is sent until you are ready.') : null,
      ] },
      { title: 'Your products', draw: () => [
        h('p', 'How would you like to add what you sell?'),
        h('div.wz-choices',
          choice(ans.products === 'sample', 'Start with examples', 'A few sample items to try things out — edit or delete them any time', () => { ans.products = 'sample'; draw(); }, 'sparkles'),
          choice(ans.products === 'type', 'Type a few now', 'Name and price is enough', () => { ans.products = 'type'; draw(); }, 'edit'),
          choice(ans.products === 'import', 'From a spreadsheet', 'Excel/CSV from your old system — opens the import screen after setup', () => { ans.products = 'import'; draw(); }, 'upload')),
        ans.products === 'type' ? h('div.wz-items',
          ans.items.map((it, i) => h('div.wz-item',
            input(it, 'name', { placeholder: `Item ${i + 1} name`, 'aria-label': `Item ${i + 1} name` }),
            input(it, 'price', { type: 'number', min: 0, step: 'any', placeholder: 'Price', 'aria-label': `Item ${i + 1} price` }),
            input(it, 'category', { placeholder: 'Category (optional)', 'aria-label': `Item ${i + 1} category` }))),
          ans.items.length < 20 ? h('button.btn.sm', { type: 'button', onclick: () => { ans.items.push({ name: '', price: '', category: '' }); draw(); } }, icon('plus', 14), 'Another item') : null) : null,
      ], check: () => (ans.products === 'type' && !ans.items.some((i) => i.name.trim() && Number(i.price) > 0) ? 'Add at least one item with a name and a price' : null) },
      { title: 'How do customers pay?', draw: () => [
        h('p', 'Tick everything you accept. Cash is always on.'),
        h('div.form-grid',
          check(ans.methods, 'cash', 'Cash', null, true),
          check(ans.methods, 'card', 'Card (on your own card machine)'),
          check(ans.methods, 'qr', 'Fonepay / bank QR', 'upload your QR picture later in Connectors'),
          check(ans.methods, 'esewa', 'eSewa', 'starts in test mode'),
          check(ans.methods, 'khalti', 'Khalti', 'needs your Khalti key — Connectors › Payments'),
          check(ans.methods, 'stripe', 'International cards (Stripe)', 'needs your Stripe key — Connectors › Payments')),
      ] },
    ];

    const draw = () => {
      const s = STEPS[step];
      dots.replaceChildren(...STEPS.map((x, i) => h(`li${i === step ? '.on' : i < step ? '.done' : ''}`, h('span', i + 1), h('small', x.title))));
      body.replaceChildren(h('h3', s.title), ...s.draw().filter(Boolean));
      back.hidden = step === 0;
      next.replaceChildren(step === STEPS.length - 1 ? 'Finish' : 'Next', icon(step === STEPS.length - 1 ? 'check' : 'chevronRight', 16));
      body.querySelector('input:not([type=checkbox])')?.focus();
    };

    const go = async () => {
      const problem = STEPS[step].check?.();
      if (problem) return toast(problem, 'warn');
      if (step < STEPS.length - 1) { step++; return draw(); }
      next.disabled = true;
      try {
        const r = await post('/api/onboarding', {
          business: ans.business, businessType: ans.businessType, vat: ans.vat, pricesIncludeTax: ans.pricesIncludeTax, serviceCharge: ans.serviceCharge,
          sample: ans.products === 'sample', items: ans.products === 'type' ? ans.items.map((i) => ({ ...i, price: Number(i.price) })) : [], methods: ans.methods,
        });
        dispatch({ type: 'boot', boot: await get('/api/bootstrap') });
        overlay.remove();
        if (r.finishInConnectors.length) toast(`Finish ${r.finishInConnectors.map((g) => ({ esewa: 'eSewa', khalti: 'Khalti', stripe: 'Stripe' }[g] || g)).join(', ')} in Connectors › Payments when you have the account details`, 'info', 8000);
        resolve(ans.products === 'import' ? 'import' : 'tour');
      } catch (e) { next.disabled = false; errorToast(e); }
    };

    overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); go(); } });
    document.body.append(overlay);
    draw();
  });
}

/** Three numbered bubbles over the selling screen. Shown once after setup, or from Help. */
export function sellTour() {
  const marks = [
    ['.catalog .search-wrap', '1', 'Tap a product, search for it, or scan its barcode.'],
    ['.member-search', '2', 'Optional: pick the customer. Members get their discount automatically.'],
    ['.pay', '3', 'Press Charge (or F9) and choose how they pay. That\'s it.'],
  ];
  document.querySelector('.tour')?.remove();
  const layer = h('div.tour', { role: 'dialog', 'aria-label': 'Quick tour' });
  const place = () => {
    layer.replaceChildren(...marks.map(([sel, n, text]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const below = r.bottom + 110 < window.innerHeight;
      const left = Math.max(8, Math.min(window.innerWidth - 280, r.left));
      const pos = below ? { top: `${r.bottom + 8}px`, left: `${left}px` } : { bottom: `${window.innerHeight - r.top + 8}px`, left: `${left}px` };
      return h('div.tour-tip', { style: pos }, h('b.tour-n', n), h('span', text));
    }).filter(Boolean), h('button.btn.primary.tour-done', { type: 'button', onclick: () => { layer.remove(); window.removeEventListener('resize', place); } }, 'Got it'));
  };
  document.body.append(layer);
  setTimeout(place, 50);
  window.addEventListener('resize', place);
}
