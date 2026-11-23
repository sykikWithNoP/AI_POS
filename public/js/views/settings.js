// Settings: business profile, tax, appearance, security, extensions (+ AI builder), backup.
import { h, icon, toast, errorToast, modal, field, badge, confirmDialog, formValues, money, toMajor, debounce, empty } from '../ui.js';
import { get, put, post, del } from '../api.js';
import { getState, dispatch } from '../store.js';
import { loadedExtensions } from '../extensions.js';
import { applyTheme } from '../theme.js';

export function renderSettings(root) {
  const s = getState().boot.settings;
  root.replaceChildren(h('div.settings',
    groupCard('business', 'Business profile', 'receipt', [
      ['name', 'Shop name'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email'], ['pan', 'PAN / VAT number', 'Printed on tax invoices'],
      ['logoUrl', 'Logo URL'], ['currency', 'Currency code'], ['currencySymbol', 'Currency symbol'], ['locale', 'Number locale', 'e.g. en-IN, ne-NP, en-US'],
      ['invoicePrefix', 'Invoice prefix'], ['receiptFooter', 'Receipt footer'],
      ['calendar', 'Month view calendar', null, ['AD', 'BS']],
      ['publicUrl', 'Public URL (optional)', 'Only if you expose the POS via a tunnel/LAN — used for bill links, QR codes and webhooks'],
    ], s.business),
    groupCard('tax', 'Tax & charges', 'tag', [
      ['label', 'Tax label'], ['rate', 'Default tax rate %', 'Nepal VAT is 13%', null, 'number'], ['inclusive', 'Prices include tax', null, 'toggle'],
      ['serviceChargeRate', 'Service charge %', 'Applied before VAT (restaurants: 10%)', null, 'number'],
    ], s.tax),
    groupCard('ui', 'Appearance & sound', 'moon', [
      ['theme', 'Theme', null, ['system', 'light', 'dark']], ['sound', 'Payment chime', null, 'toggle'],
    ], s.ui, () => applyTheme(getState().boot.settings.ui.theme)),
    membershipsCard(),
    groupCard('checkout', 'Checkout & pay later', 'wallet', [
      ['allowPostpone', 'Allow pay later (postponed payments)', null, 'toggle'],
      ['postponeRequiresCustomer', 'Pay later only for saved customers', null, 'toggle'],
      ['defaultDueDays', 'Default days until due', 'Bill is issued now; payment collected later', null, 'number'],
      ['maxDiscountPercent', 'Max discount without owner PIN (%)', 'Manual + extension discounts above this need the PIN. Member pricing and points are not counted.', null, 'number'],
    ], s.checkout),
    groupCard('loyalty', 'Loyalty points', 'sparkles', [
      ['enabled', 'Loyalty points enabled', null, 'toggle'],
      ['earnPer', 'Spend per earning step', 'e.g. 100 = every Rs 100 spent', null, 'number'],
      ['earnPoints', 'Points per step', 'Members multiply this by their tier multiplier', null, 'number'],
      ['pointValue', 'Value of 1 point when redeemed', null, null, 'number'],
      ['minRedeem', 'Minimum points to redeem', null, null, 'number'],
    ], s.loyalty),
    groupCard('shifts', 'Shifts & cash drawer', 'wallet', [
      ['required', 'Require an open shift to sell', 'Off: shifts are optional; sales without a shift are still recorded', 'toggle'],
    ], s.shifts),
    securityCard(),
    integrityCard(),
    extensionsCard(),
    backupCard()));
}

function groupCard(group, title, ic, fields, values, after) {
  const form = h('form.form-grid.two', { onsubmit: (e) => e.preventDefault() });
  for (const [name, label, hint, opts, type] of fields) {
    if (opts === 'toggle') { form.append(h('label.toggle', h('input', { type: 'checkbox', name, checked: !!values[name] }), h('span.track'), h('span', label))); continue; }
    const el = Array.isArray(opts)
      ? h('select.input', { name }, opts.map((o) => h('option', { value: o, selected: values[name] === o }, o)))
      : h('input.input', { name, type: type || 'text', step: 'any', value: values[name] ?? '' });
    form.append(field(label, el, hint));
  }
  return h('section.card',
    h('header.card-head', h('h3', icon(ic, 18), title)),
    form,
    h('footer.conn-actions', h('button.btn.primary', { onclick: async () => {
      try {
        await put(`/api/settings/${group}`, { values: formValues(form) });
        dispatch({ type: 'boot', boot: await get('/api/bootstrap') });
        after?.();
        toast('Saved', 'success');
      } catch (e) { errorToast(e); }
    } }, 'Save')));
}

function securityCard() {
  const sec = getState().boot.settings.security;
  const current = h('input.input', { type: 'password', inputMode: 'numeric', placeholder: 'Current PIN', autocomplete: 'off' });
  const pin = h('input.input', { type: 'password', inputMode: 'numeric', placeholder: 'New PIN (4–8 digits)', autocomplete: 'off' });
  const lock = h('input', { type: 'checkbox', checked: !!sec.lockScreen });
  const mins = h('input.input', { type: 'number', min: 1, max: 60, value: sec.elevateMinutes || 10 });
  const notifyBtn = 'Notification' in window && Notification.permission !== 'granted'
    ? h('button.btn', { onclick: () => Notification.requestPermission().then((p) => toast(`Desktop notifications: ${p}`)) }, icon('bell', 16), 'Enable desktop notifications') : null;
  return h('section.card',
    h('header.card-head', h('h3', icon('lock', 18), 'Security'), badge('Local only', 'ok')),
    h('p.hint', 'The POS only answers on this computer (localhost). Selling needs no PIN; rules, records and keys always ask for the owner PIN, which stays valid for a few minutes. Wrong PINs lock out with growing delays and are logged.'),
    h('div.form-grid.two',
      h('label.toggle', lock, h('span.track'), h('span', 'Also require the PIN to open the POS')),
      field('PIN stays valid for (minutes)', mins)),
    h('footer.conn-actions', h('button.btn', { onclick: async () => {
      try { await put('/api/settings/security', { values: { lockScreen: lock.checked, elevateMinutes: mins.value } }); dispatch({ type: 'boot', boot: await get('/api/bootstrap') }); toast('Saved', 'success'); } catch (e) { errorToast(e); }
    } }, 'Save')),
    h('h4', 'Change owner PIN'),
    h('div.form-grid.two', field('Current PIN', current), field('New PIN', pin)),
    h('footer.conn-actions', notifyBtn,
      h('button.btn.primary', { onclick: async () => {
        try { await post('/api/auth/pin', { current: current.value, pin: pin.value }, { noPinRetry: true }); current.value = ''; pin.value = ''; toast('PIN changed', 'success'); } catch (e) { errorToast(e); }
      } }, 'Change PIN')));
}

function integrityCard() {
  const status = h('div', h('p.muted', 'Checking…'));
  const log = h('ul.audit');
  const check = async () => {
    try {
      const r = await get('/api/integrity');
      status.replaceChildren(r.ok
        ? h('div.integrity.ok', icon('check', 18), h('span', h('b', 'All records verified. '), `${r.entries} signed ledger entries · checked ${new Date(r.checkedAt).toLocaleTimeString()}`))
        : h('div.integrity.bad', icon('shield', 18), h('div', h('b', `Tampering detected (${r.problems.length})`), h('ul', r.problems.slice(0, 10).map((p) => h('li', `${p.kind} ${p.ref || ''}: ${p.reason}`))))));
    } catch (e) { status.replaceChildren(h('p.danger-text', e.message)); }
    try {
      const rows = await get('/api/audit?limit=40');
      log.replaceChildren(...rows.map((r) => h('li', h('time', new Date(r.created_at).toLocaleString()), h('code', r.kind), h('span.muted', r.ref), h('small', summarize(r)))));
    } catch { /* ignore */ }
  };
  check();
  return h('section.card.span2',
    h('header.card-head', h('h3', icon('shield', 18), 'Integrity & audit log'), h('button.btn.sm', { onclick: check }, icon('refresh', 14), 'Verify now')),
    h('p.hint', 'Every bill, payment, refund, cash movement, rule change and protected action is signed into an append-only chain. Bills, payments and refunds cannot be edited or deleted, and any change made outside the POS (for example directly in the database file) shows up here.'),
    status, h('h4', 'Recent activity'), log);
}
const summarize = (r) => {
  const p = r.payload || {};
  if (r.kind === 'sale.issued') return `${p.invoice_no} · total ${(p.total / 100).toFixed(2)}`;
  if (r.kind === 'settings.changed') return Object.keys(p).join(', ');
  if (r.kind.startsWith('security.')) return p.reason || (p.fails ? `${p.fails} failed` : '');
  if (p.amount !== undefined) return `${(p.amount / 100).toFixed(2)}${p.method ? ' · ' + p.method : ''}`;
  return '';
};

function extensionsCard() {
  const list = h('ul.ext-list');
  const load = async () => {
    const exts = await get('/api/extensions');
    const status = new Map(loadedExtensions().map((x) => [x.id, x]));
    list.replaceChildren(...(exts.length ? exts.map((x) => h('li',
      h('div', h('b', x.name), x.description ? h('small.muted', ` — ${x.description}`) : null,
        status.get(x.id)?.error ? h('div.danger-text', `Load error: ${status.get(x.id).error}`) : null),
      h('div.row-actions',
        h('label.toggle', h('input', { type: 'checkbox', checked: x.enabled, onchange: async (e) => { await put(`/api/extensions/${x.id}`, { enabled: e.target.checked }); toast('Reload the page to apply', 'info'); } }), h('span.track'), h('span', x.enabled ? 'On' : 'Off')),
        h('button.icon-btn', { title: 'Edit', 'aria-label': `Edit ${x.name}`, onclick: () => editor(x, load) }, icon('edit', 16)),
        h('button.icon-btn', { title: 'Delete', 'aria-label': `Delete ${x.name}`, onclick: async () => { if (await confirmDialog(`Delete extension "${x.name}"?`, { danger: true, okLabel: 'Delete' })) { await del(`/api/extensions/${x.id}`); load(); } } }, icon('trash', 16))))) : [h('li.muted', 'No extensions yet. Write one or let AI draft it from a description.')]));
  };
  load().catch(errorToast);
  return h('section.card.span2',
    h('header.card-head', h('h3', icon('code', 18), 'Extensions — build your own features')),
    h('p.hint', 'Extensions are small JavaScript plugins that hook into the POS: discount rules, toolbar buttons, checkout checks, custom items, reactions to payments. They run in a locked sandbox with no internet, no access to your keys or settings, and they cannot change prices or tax rules — the server re-checks every bill.'),
    list,
    h('footer.conn-actions',
      h('button.btn', { onclick: () => aiBuilder(load) }, icon('sparkles', 16), 'Describe a feature (AI)'),
      h('button.btn.primary', { onclick: () => editor(null, load) }, icon('plus', 16), 'New extension')));
}

const TEMPLATE = `// Example: Happy hour — 10% off drinks between 4 and 6 pm
pos.addDiscountRule('Happy hour drinks', (cart) => {
  const hour = pos.now().getHours();
  if (hour < 16 || hour >= 18) return 0;
  const drinks = cart.lines.filter((l) => l.category === 'Drinks');
  return drinks.reduce((sum, l) => sum + l.total * 0.10, 0);
});

pos.on('sale:complete', (sale) => {
  if (sale.total >= 500000) pos.toast('Big sale! 🎉', 'success'); // amounts on sale objects are in paisa
});`;

async function editor(ext, done) {
  const name = h('input.input', { value: ext?.name || '' });
  const description = h('input.input', { value: ext?.description || '' });
  const code = h('textarea.input.mono.code-editor', { rows: 16, spellcheck: false, value: ext?.code || TEMPLATE });
  const enabled = h('input', { type: 'checkbox', checked: !!ext?.enabled });
  let apiDoc = '';
  try { apiDoc = (await get('/api/extensions-api')).doc; } catch { /* ignore */ }
  modal({
    title: ext?.id ? `Edit ${ext.name}` : (ext ? `Review AI draft: ${ext.name}` : "New extension"), wide: true,
    body: h('div.form-grid', field('Name', name), field('Description', description), field('Code', code),
      h('label.toggle', enabled, h('span.track'), h('span', 'Enabled (I have reviewed this code)')),
      h('details', h('summary', 'Extension API reference'), h('pre.code', apiDoc))),
    actions: [{ label: 'Cancel', onClick: (c) => c() }, { label: 'Save', primary: true, onClick: async (c) => {
      try { // the server checks syntax and rejects anything outside the pos API

        const body = { name: name.value, description: description.value, code: code.value, enabled: enabled.checked };
        ext?.id ? await put(`/api/extensions/${ext.id}`, body) : await post('/api/extensions', body);
        toast('Extension saved — reload to apply', 'success'); c(); done();
      } catch (e) { errorToast(e); }
    } }],
  });
}

function aiBuilder(done) {
  const ta = h('textarea.input', { rows: 4, placeholder: 'e.g. "Give 5% off when a customer with a PAN buys more than Rs 5000" or "Add a button that adds a Rs 50 delivery charge"' });
  modal({
    title: 'Build a feature with AI', wide: true,
    body: h('div', h('p.hint', 'Uses your Anthropic key from Connectors. The draft opens in the editor disabled, so you can read it before turning it on.'), ta),
    actions: [{ label: 'Generate', primary: true, onClick: async (c) => {
      const btn = document.querySelector('.modal-actions .primary');
      btn.disabled = true; btn.textContent = 'Generating…';
      try {
        const draft = await post('/api/ai/extension', { description: ta.value });
        c();
        editor({ ...draft, enabled: false, id: null }, done).then(() => {});
      } catch (e) { errorToast(e); btn.disabled = false; btn.textContent = 'Generate'; }
    } }],
  });
}

function backupCard() {
  return h('section.card',
    h('header.card-head', h('h3', icon('download', 18), 'Backup')),
    h('p.hint', 'Download a consistent copy of the whole database (items, bills, settings). Keep the data/secret.key file too — it decrypts your saved API keys.'),
    h('footer.conn-actions', h('a.btn.primary', { href: '/api/backup.db' }, icon('download', 16), 'Download backup')));
}

// ---------- Memberships: tiers, default tier, and per-customer tier assignment ----------
function membershipsCard() {
  const plansBox = h('div.tiers');
  const assignBox = h('div');
  const defaultSel = h('select.input', { 'aria-label': 'Default tier for new customers' });
  let plans = [];

  async function reloadBoot() { dispatch({ type: 'boot', boot: await get('/api/bootstrap') }); }

  async function load() {
    const r = await get('/api/membership-plans?all=1');
    plans = r.plans;
    const count = new Map(r.stats.map((x) => [x.id, x.members]));
    plansBox.replaceChildren(...(plans.length ? plans.map((p) => h('div.tier', { style: p.color ? { '--tint': p.color } : undefined },
      h('div', h('b', `★ ${p.name}`), p.active ? null : badge('archived'),
        h('div.muted', `${p.discount_percent}% off · ${p.points_multiplier}× points · ${p.fee ? money(p.fee) : 'free'} · ${p.duration_days ? p.duration_days + ' days' : 'lifetime'}`),
        p.perks ? h('small', p.perks) : null),
      h('div.row-actions', h('small.muted', `${count.get(p.id) || 0} member${count.get(p.id) === 1 ? '' : 's'}`),
        h('button.icon-btn', { 'aria-label': `Edit ${p.name}`, onclick: () => planDialog(p) }, icon('edit', 16)),
        h('button.icon-btn', { 'aria-label': `Delete ${p.name}`, onclick: async () => {
          if (!(await confirmDialog(`Delete tier "${p.name}"? Tiers with members are archived instead.`, { danger: true, okLabel: 'Delete' }))) return;
          await del(`/api/membership-plans/${p.id}`); await reloadBoot(); load();
        } }, icon('trash', 16))))) : [empty('No tiers yet. Add e.g. Silver, Gold, VIP.', 'sparkles')]));
    const def = getState().boot.settings.memberships.defaultPlanId;
    defaultSel.replaceChildren(h('option', { value: 0 }, 'None'), ...plans.filter((p) => p.active).map((p) => h('option', { value: p.id, selected: p.id === def }, p.name)));
    drawAssign();
  }

  function planDialog(p) {
    const f = {
      name: h('input.input', { value: p?.name || '', placeholder: 'Gold' }),
      discount_percent: h('input.input', { type: 'number', min: 0, max: 100, step: 'any', value: p?.discount_percent ?? 5 }),
      points_multiplier: h('input.input', { type: 'number', min: 0, step: 'any', value: p?.points_multiplier ?? 1 }),
      fee: h('input.input', { type: 'number', min: 0, step: 'any', value: p ? toMajor(p.fee) : 0 }),
      duration_days: h('input.input', { type: 'number', min: 0, step: 1, value: p?.duration_days ?? 365 }),
      color: h('input.input', { type: 'color', value: p?.color || '#d97706' }),
      perks: h('input.input', { value: p?.perks || '', placeholder: 'e.g. Free delivery, birthday gift' }),
      active: h('input', { type: 'checkbox', checked: p ? p.active : true }),
    };
    modal({
      title: p ? `Edit ${p.name}` : 'New membership tier', wide: true,
      body: h('div.form-grid.two', field('Tier name', f.name), field('Member discount %', f.discount_percent, 'Applied automatically at checkout'),
        field('Points multiplier', f.points_multiplier, '2 = members earn double points'), field('Fee', f.fee, '0 = free tier'),
        field('Valid for (days)', f.duration_days, '0 = lifetime'), field('Colour', f.color), field('Perks (shown to staff)', f.perks),
        h('label.toggle', f.active, h('span.track'), h('span', 'Available to sell'))),
      actions: [{ label: 'Save', primary: true, onClick: async (c) => {
        const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
        try { p ? await put(`/api/membership-plans/${p.id}`, body) : await post('/api/membership-plans', body); c(); await reloadBoot(); load(); toast('Tier saved', 'success'); } catch (e) { errorToast(e); }
      } }],
    });
  }

  // Choose which tier each customer gets.
  let q = '';
  const search = h('input.input', { type: 'search', placeholder: 'Find customers to set their tier…', 'aria-label': 'Search customers' });
  const list = h('ul.assign-list');
  search.addEventListener('input', debounce(() => { q = search.value.trim(); drawAssign(); }, 200));
  async function drawAssign() {
    const customers = await get(`/api/customers?limit=12${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    const active = plans.filter((p) => p.active);
    list.replaceChildren(...(customers.length ? customers.map((c) => {
      const sel = h('select.input', { 'aria-label': `Tier for ${c.name}` }, h('option', { value: 0 }, '— No tier —'),
        ...active.map((p) => h('option', { value: p.id, selected: c.membership?.planId === p.id }, p.name)));
      sel.addEventListener('change', async () => {
        try {
          const r = await put(`/api/customers/${c.id}/tier`, { planId: Number(sel.value) });
          toast(r.membership ? `${c.name} → ${r.membership.name}` : `${c.name}: tier removed`, 'success');
        } catch (e) { errorToast(e); }
      });
      return h('li', h('div', h('b', c.name), h('small.muted', ` ${c.phone || ''}${c.membership?.until ? ' · until ' + new Date(c.membership.until).toLocaleDateString() : ''}`)), sel);
    }) : [h('li.muted', 'No customers found — add them from POS → Customers.')]));
  }

  load().catch(errorToast);
  return h('section.card.span2',
    h('header.card-head', h('h3', '★ Memberships'), h('button.btn.primary', { onclick: () => planDialog(null) }, icon('plus', 16), 'New tier')),
    h('p.hint', 'Create tiers with an automatic discount and a points multiplier. Sell them from the ★ Membership button on the POS (activates when paid), or set a customer\'s tier directly below.'),
    plansBox,
    h('div.form-grid.two',
      field('Default tier for new customers', defaultSel, 'New customers are enrolled automatically (free)'),
      h('div', h('button.btn', { style: { marginTop: '22px' }, onclick: async () => {
        try { await put('/api/settings/memberships', { values: { defaultPlanId: Number(defaultSel.value) } }); await reloadBoot(); toast('Default tier saved', 'success'); } catch (e) { errorToast(e); }
      } }, 'Save default'))),
    h('h4', 'Customer tiers'), search, list,
    assignBox);
}

