// Customers: directory, loyalty points, memberships; plus the picker used by the cart.
import { h, icon, money, toMajor, toast, errorToast, modal, field, confirmDialog, empty, debounce, badge, fmtDate, promptDialog } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { getState, dispatch } from '../store.js';

const memberBadge = (m) => (m ? h('span.member-tag', { style: m.color ? { background: m.color } : undefined }, `★ ${m.name}`) : null);
const until = (m) => (m?.until ? `until ${fmtDate(m.until, { dateStyle: 'medium' })}` : 'lifetime');

export function renderCustomers(root) {
  let q = '';
  const tbody = h('tbody');
  const search = h('input.input', { type: 'search', placeholder: 'Name, phone or PAN…', 'aria-label': 'Search customers' });
  root.replaceChildren(
    h('div.toolbar', h('div.search-wrap', icon('search', 18), search),
      h('div.toolbar-actions', h('button.btn.primary', { onclick: () => editDialog(null, load) }, icon('plus', 16), 'Add customer'))),
    h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', 'Customer'), h('th', 'Phone'), h('th', 'Membership'), h('th.n', 'Points'), h('th.n', 'Visits'), h('th.n', 'Spent'), h('th', 'Last visit'))), tbody)));
  async function load() {
    const list = await get(`/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    tbody.replaceChildren(...(list.length ? list.map((c) => h('tr.clickable', { onclick: () => detailDialog(c.id, load) },
      h('td', h('b', c.name), c.pan ? h('small.muted', ` · PAN ${c.pan}`) : null), h('td', c.phone || '—'),
      h('td', c.membership ? [memberBadge(c.membership), h('small.muted', ` ${until(c.membership)}`)] : c.membershipExpired ? badge('Expired', 'warn') : '—'),
      h('td.n', c.points), h('td.n', c.visits), h('td.n', money(c.total_spent)), h('td', c.last_visit ? fmtDate(c.last_visit, { dateStyle: 'medium' }) : '—'))) : [h('tr', h('td', { colSpan: 7 }, empty(q ? 'No matches' : 'No customers yet', 'user')))]));
  }
  search.addEventListener('input', debounce(() => { q = search.value.trim(); load(); }, 200));
  load().catch(errorToast);
}

function editDialog(c, done) {
  const f = {
    name: h('input.input', { value: c?.name || '' }), phone: h('input.input', { type: 'tel', value: c?.phone || '' }),
    email: h('input.input', { type: 'email', value: c?.email || '' }), pan: h('input.input', { value: c?.pan || '', maxLength: 9, inputMode: 'numeric' }),
    notes: h('textarea.input', { rows: 2, value: c?.notes || '' }),
  };
  modal({
    title: c ? `Edit ${c.name}` : 'New customer',
    body: h('div.form-grid.two', field('Name *', f.name), field('Phone', f.phone), field('Email', f.email), field('PAN / VAT', f.pan), field('Notes', f.notes)),
    actions: [{ label: 'Save', primary: true, onClick: async (close) => {
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      try { const saved = c ? await put(`/api/customers/${c.id}`, body) : await post('/api/customers', body); close(); toast('Customer saved', 'success'); done?.(saved); } catch (e) { errorToast(e); }
    } }],
  });
}

async function detailDialog(id, refresh) {
  const c = await get(`/api/customers/${id}`);
  const plans = getState().boot.plans;
  const m = modal({
    title: c.name, wide: true,
    body: h('div',
      h('div.meta-grid',
        h('div', h('small', 'Membership'), c.membership ? [memberBadge(c.membership), h('div.muted', until(c.membership))] : c.membershipExpired ? badge('Expired', 'warn') : 'None'),
        h('div', h('small', 'Points'), h('b', c.points)), h('div', h('small', 'Visits'), c.visits), h('div', h('small', 'Total spent'), money(c.total_spent)),
        h('div', h('small', 'Phone'), c.phone || '—'), h('div', h('small', 'PAN'), c.pan || '—')),
      c.notes ? h('p.hint', c.notes) : null,
      h('h4', 'Recent bills'),
      c.history.length ? h('ul.rank', c.history.map((s) => h('li', h('span', s.invoice_no), h('small.muted', fmtDate(s.created_at)), badge(s.status, { paid: 'ok', pending: 'warn', void: 'bad' }[s.status]),
        s.points_earned ? h('small.ok-text', `+${s.points_earned}`) : null, s.points_redeemed ? h('small.warn-text', `−${s.points_redeemed}`) : null, h('b', money(s.total))))) : h('p.muted', 'No bills yet')),
    actions: [
      { label: 'Start sale', primary: true, onClick: (close) => { dispatch({ type: 'cart/customer', customer: c, replace: true }); close(); location.hash = '#/pos'; toast(`Selling to ${c.name}`); } },
      ...(plans.length ? [{ label: c.membership ? 'Renew / change plan' : 'Sell membership', onClick: (close) => { close(); sellMembership(c); } }] : []),
      ...(plans.length ? [{ label: 'Comp membership', onClick: async (close) => {
        const plan = await choosePlan('Give a membership for free (no bill)');
        if (!plan) return;
        try { await post(`/api/customers/${c.id}/membership`, { planId: plan.id }); toast(`${c.name} is now ${plan.name}`, 'success'); close(); refresh(); } catch (e) { errorToast(e); }
      } }] : []),
      ...(c.membership ? [{ label: 'Cancel membership', danger: true, onClick: async (close) => {
        if (!(await confirmDialog(`Cancel ${c.name}'s ${c.membership.name} membership? No automatic refund is made.`, { danger: true, okLabel: 'Cancel membership' }))) return;
        await del(`/api/customers/${c.id}/membership`); close(); refresh();
      } }] : []),
      { label: 'Adjust points', onClick: async (close) => {
        const v = await promptDialog('Add (positive) or remove (negative) points', '', { title: 'Adjust points', type: 'number' });
        if (!v) return;
        try { await post(`/api/customers/${c.id}/points`, { delta: Number(v) }); close(); refresh(); } catch (e) { errorToast(e); }
      } },
      { label: 'Edit', onClick: (close) => { close(); editDialog(c, refresh); } },
      { label: 'Delete', danger: true, onClick: async (close) => {
        if (!(await confirmDialog(`Delete ${c.name}? Their bills are kept.`, { danger: true, okLabel: 'Delete' }))) return;
        await del(`/api/customers/${c.id}`); close(); refresh();
      } },
    ],
  });
  return m;
}

function choosePlan(title) {
  return new Promise((resolve) => {
    let picked = false;
    const plans = getState().boot.plans;
    const m = modal({ title, onClose: () => { if (!picked) resolve(null); },
      body: h('div.plan-list', plans.map((p) => h('button.plan', { style: p.color ? { '--tint': p.color } : undefined, onclick: () => { picked = true; resolve(p); m.close(); } },
        h('b', `★ ${p.name}`), h('span', `${p.discount_percent}% off · ${p.points_multiplier}× points`), h('small.muted', `${p.fee ? money(p.fee) : 'Free'} · ${p.duration_days ? `${p.duration_days} days` : 'lifetime'}`), p.perks ? h('small', p.perks) : null))) });
  });
}

/** Put the customer on the cart and add the chosen membership plan as a bill line. */
async function sellMembership(c) {
  const plan = await choosePlan(`Membership for ${c.name}`);
  if (!plan) return;
  dispatch({ type: 'cart/customer', customer: c, replace: true });
  dispatch({ type: 'cart/add', item: { id: null, membershipPlanId: plan.id, name: `Membership: ${plan.name}`, price: plan.fee, category: 'Membership', emoji: '★' } });
  location.hash = '#/pos';
  toast(`Membership added to the bill — it activates when paid`, 'info', 5000);
}

/** Cart customer picker: search existing, quick-add, or walk-in with just a name/PAN. */
export function pickCustomerDialog(current, apply) {
  const search = h('input.input', { type: 'search', placeholder: 'Search name, phone, PAN…', value: current?.id ? '' : '' });
  const results = h('ul.pick-list');
  const draw = async () => {
    const q = search.value.trim();
    const list = await get(`/api/customers?limit=8${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    results.replaceChildren(...list.map((c) => h('li', h('button.pick', { onclick: () => { apply(c); m.close(); } },
      h('span', h('b', c.name), memberBadge(c.membership)), h('small.muted', [c.phone, `${c.points} pts`].filter(Boolean).join(' · '))))),
    h('li', h('button.pick.add', { onclick: () => { m.close(); editDialog(q ? { name: /^\d+$/.test(q) ? '' : q, phone: /^\d+$/.test(q) ? q : '' } : null, (saved) => apply(saved)); } }, icon('plus', 16), q ? `Add "${q}" as new customer` : 'New customer')));
  };
  const m = modal({
    title: 'Customer', wide: true,
    body: h('div.form-grid', search, results,
      h('details', h('summary', 'Walk-in with name / PAN only (no profile)'), walkInForm(current, (c) => { apply(c); m.close(); }))),
    actions: [
      current?.id && getState().boot.plans.length ? { label: 'Sell membership', onClick: (close) => { close(); sellMembership(current); } } : null,
      { label: 'Walk-in customer', onClick: (close) => { apply({}); close(); } },
    ].filter(Boolean),
  });
  search.addEventListener('input', debounce(draw, 150));
  draw().catch(errorToast);
}

function walkInForm(current, done) {
  const name = h('input.input', { placeholder: 'Name', value: current?.id ? '' : current?.name || '' });
  const pan = h('input.input', { placeholder: '9-digit PAN for a tax invoice', maxLength: 9, inputMode: 'numeric', value: current?.id ? '' : current?.pan || '' });
  return h('div.form-grid.two', name, pan, h('button.btn', { onclick: () => {
    if (pan.value && !/^\d{9}$/.test(pan.value)) return toast('PAN must be 9 digits', 'warn');
    done({ name: name.value.trim(), pan: pan.value.trim() });
  } }, 'Use'));
}

export { toMajor };
