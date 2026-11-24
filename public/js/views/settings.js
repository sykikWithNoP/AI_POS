// Settings: business profile, tax, appearance, security, extensions (+ AI builder), backup.
import { h, icon, toast, errorToast, modal, field, badge, confirmDialog, formValues, money, toMajor, debounce, empty, imageInput } from '../ui.js';
import { get, put, post, del } from '../api.js';
import { getState, dispatch } from '../store.js';
import { loadedExtensions, reloadExtensions } from '../extensions.js';
import { showOwnerKey, ownerSignOut } from '../owner.js';
import { applyTheme, THEMES, VAR_KEYS, paletteFromImage, paletteFromHue, prepareImage, setImageVars, contrast } from '../theme.js';

/** Settings sub-pages. Each one is a column of cards with its own Save button. */
const PAGES = {
  business: (s) => [
    groupCard('business', 'Business profile', 'receipt', [
      ['name', 'Shop name'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email'], ['pan', 'PAN / VAT number', 'Printed on tax invoices'],
      ['logoUrl', 'Logo (stored on this PC)', null, 'image'], ['currency', 'Currency code'], ['currencySymbol', 'Currency symbol'], ['locale', 'Number locale', 'e.g. en-IN, ne-NP, en-US'],
      ['invoicePrefix', 'Invoice prefix'], ['receiptFooter', 'Receipt footer'],
      ['calendar', 'Month view calendar', null, ['AD', 'BS']],
      ['publicUrl', 'Public URL (optional)', 'Only if you expose the POS via a tunnel/LAN — used for bill links, QR codes and webhooks'],
    ], s.business),
    groupCard('tax', 'Tax & charges', 'tag', [
      ['label', 'Tax label'], ['rate', 'Default tax rate %', 'Nepal VAT is 13%', null, 'number'], ['inclusive', 'Prices include tax', null, 'toggle'],
      ['serviceChargeRate', 'Service charge %', 'Applied before VAT (restaurants: 10%)', null, 'number'],
    ], s.tax),
  ],
  appearance: () => [appearanceCard()],
  selling: (s) => [
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
  ],
  memberships: () => [membershipsCard()],
  security: () => [securityCard(), integrityCard(), privacyCard()],
  extensions: () => [extensionsCard()],
  data: () => [migrationCard(), backupCard()],
  updates: () => [updatesCard(), systemCard()],
};

export function renderSettings(root, { sub = 'business' } = {}) {
  const s = getState().boot.settings;
  root.replaceChildren(h('div.settings', (PAGES[sub] || PAGES.business)(s)));
}

function groupCard(group, title, ic, fields, values, after) {
  const form = h('form.form-grid.two', { onsubmit: (e) => e.preventDefault() });
  for (const [name, label, hint, opts, type] of fields) {
    if (opts === 'toggle') { form.append(h('label.toggle', h('input', { type: 'checkbox', name, checked: !!values[name] }), h('span.track'), h('span', label))); continue; }
    if (opts === 'image') { const el = imageInput(values[name]); el.dataset.name = name; form.append(field(label, el, hint)); continue; }
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
        const values = formValues(form);
        for (const el of form.querySelectorAll('.image-input')) values[el.dataset.name] = el.dataset.image;
        await put(`/api/settings/${group}`, { values });
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
    h('h4', 'Owner account'),
    h('p.hint', `Signed in as ${getState().boot.settings.security.ownerUser || 'owner'}. Owner areas sign out after ${sec.ownerIdleMinutes || 30} idle minutes.`),
    h('div.row-actions',
      h('button.btn', { onclick: async () => {
        const pw = h('input.input', { type: 'password', placeholder: 'Owner password' });
        const pn = h('input.input', { type: 'password', inputMode: 'numeric', placeholder: 'PIN' });
        modal({ title: 'Replace Owner Key', body: h('div.form-grid', h('p.hint', 'The old key stops working immediately.'), field('Password', pw), field('PIN', pn)),
          actions: [{ label: 'Replace key', primary: true, onClick: async (c) => {
            try { const r = await post('/api/auth/owner/new-key', { password: pw.value, pin: pn.value }, { noPinRetry: true }); c(); await showOwnerKey(r.ownerKey, getState().boot.settings.security.ownerUser); } catch (e) { errorToast(e); }
          } }] });
      } }, icon('key', 16), 'Replace Owner Key'),
      h('button.btn', { onclick: () => ownerSignOut() }, icon('lock', 16), 'Sign out of owner area')),
    sealControls(),
    h('h4', 'Change till PIN'),
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
  return h('section.card',
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
        h('label.toggle', h('input', { type: 'checkbox', checked: x.enabled, onchange: async (e) => { try { await put(`/api/extensions/${x.id}`, { enabled: e.target.checked }); await applyExtensions(); toast(e.target.checked ? `${x.name} is on` : `${x.name} is off`, 'success'); load(); } catch (err) { errorToast(err); } } }), h('span.track'), h('span', x.enabled ? 'On' : 'Off')),
        h('button.icon-btn', { title: 'Edit', 'aria-label': `Edit ${x.name}`, onclick: () => editor(x, load) }, icon('edit', 16)),
        h('button.icon-btn', { title: 'Delete', 'aria-label': `Delete ${x.name}`, onclick: async () => { if (await confirmDialog(`Delete extension "${x.name}"?`, { danger: true, okLabel: 'Delete' })) { await del(`/api/extensions/${x.id}`); load(); } } }, icon('trash', 16))))) : [h('li.muted', 'No extensions yet. Write one or let AI draft it from a description.')]));
  };
  load().catch(errorToast);
  return h('section.card',
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
        await applyExtensions();
        toast('Extension saved and applied', 'success'); c(); done();
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
  const list = h('ul.keys');
  const status = h('div');
  const auto = h('input', { type: 'checkbox' });
  const every = h('select.input', [6, 12, 24, 48, 168].map((n) => h('option', { value: n }, n === 168 ? 'Weekly' : `Every ${n} hours`)));
  const keep = h('input.input', { type: 'number', min: 3, max: 365 });
  const upload = h('input', { type: 'file', accept: '.db,application/octet-stream' });
  const load = async () => {
    const r = await get('/api/backups');
    auto.checked = r.settings.auto; every.value = String(r.settings.everyHours); keep.value = r.settings.keep;
    status.replaceChildren(r.restorePending ? h('div.integrity.bad', icon('refresh', 18), h('div', h('b', 'A restore is ready. '), 'Restart the POS to apply it. ',
      h('button.btn.sm', { onclick: restartNow }, 'Restart now'), ' ', h('button.btn.sm', { onclick: async () => { await post('/api/restore/cancel'); load(); } }, 'Cancel restore'))) : '');
    list.replaceChildren(...(r.backups.length ? r.backups.slice(0, 30).map((b) => h('li',
      h('div', h('b', new Date(b.created).toLocaleString()), h('small.muted', ` · ${b.reason} · ${(b.bytes / 1024).toFixed(0)} KB`)),
      h('div.row-actions',
        h('a.btn.sm', { href: `/api/backups/${encodeURIComponent(b.name)}` }, icon('download', 14), 'Download'),
        h('button.btn.sm', { onclick: async () => {
          if (!(await confirmDialog(`Restore the backup from ${new Date(b.created).toLocaleString()}? Your current data is backed up first, then replaced when the POS restarts.`, { okLabel: 'Restore', danger: true }))) return;
          try { const x = await post(`/api/backups/${encodeURIComponent(b.name)}/restore`); toast(`Restore ready: ${x.summary.sales} bills, ${x.summary.items} items. Restart to apply.`, 'success', 6000); load(); } catch (e) { errorToast(e); }
        } }, 'Restore')))) : [h('li.muted', 'No backups yet.')]));
  };
  upload.addEventListener('change', async () => {
    const f = upload.files[0];
    if (!f) return;
    if (!(await confirmDialog(`Restore from "${f.name}"? It is checked first; your current data is backed up and then replaced on restart.`, { okLabel: 'Check & restore', danger: true }))) return;
    try {
      const res = await fetch('/api/restore/upload', { method: 'POST', headers: { 'X-POS-Client': '1', 'Content-Type': 'application/octet-stream' }, body: f });
      const x = await res.json();
      if (!res.ok) throw new Error(x.message);
      toast(`Backup looks good: ${x.summary.sales} bills, ${x.summary.items} items. Restart to apply.`, 'success', 6000); load();
    } catch (e) { errorToast(e); }
    upload.value = '';
  });
  load().catch(errorToast);
  return h('section.card',
    h('header.card-head', h('h3', icon('download', 18), 'Backups & restore'), h('button.btn.sm.primary', { onclick: async () => { try { await post('/api/backups'); toast('Backup made', 'success'); load(); } catch (e) { errorToast(e); } } }, 'Back up now')),
    h('p.hint', 'Automatic backups are kept on this computer. Copy one to a USB stick every week (below).'),
    status,
    h('div.form-grid.two', h('label.toggle', auto, h('span.track'), h('span', 'Automatic backups')), field('How often', every), field('Keep how many', keep),
      h('div', h('button.btn', { style: { marginTop: '22px' }, onclick: async () => {
        try { await put('/api/settings/backup', { values: { auto: auto.checked, everyHours: Number(every.value), keep: Number(keep.value) } }); toast('Saved', 'success'); } catch (e) { errorToast(e); }
      } }, 'Save'))),
    h('h4', 'Copy off this computer'), usbBox(),
    h('h4', 'Backups on this PC'), list,
    h('h4', 'Restore from a file'), h('label.btn', icon('upload', 16), 'Choose backup file…', upload));
}

/** USB stick / external disk / synced folder: one button, plus an optional automatic copy. */
function usbBox() {
  const drives = h('select.input', { 'aria-label': 'Drive' });
  const folder = h('input.input', { placeholder: 'or type a folder, e.g. D:\\Backups or /Volumes/USB', 'aria-label': 'Backup folder' });
  const autoCopy = h('input', { type: 'checkbox' });
  const age = h('p.hint');
  const target = () => folder.value.trim() || drives.value;
  const refresh = async () => {
    const [list, b] = await Promise.all([get('/api/backups/drives'), get('/api/backups')]);
    drives.replaceChildren(...(list.length ? list.map((d) => h('option', { value: d.path }, `${d.label}${d.free != null ? ` — ${(d.free / 1e9).toFixed(1)} GB free` : ''}`)) : [h('option', { value: '' }, 'No USB stick or extra drive found — plug one in and press Refresh')]));
    autoCopy.checked = !!b.settings.externalDir;
    if (b.settings.externalDir) folder.value = b.settings.externalDir;
    const r = b.reminder;
    age.replaceChildren(r.days === null ? 'No copy has been made off this computer yet.' : `Last copy off this computer: ${r.days === 0 ? 'today' : `${r.days} day${r.days === 1 ? '' : 's'} ago`}.`, r.due ? h('b.warn-text', ' Time for a new one.') : '');
  };
  refresh().catch(errorToast);
  return h('div.usb-box',
    h('p.hint', 'If this computer breaks or is stolen, a copy on a USB stick is how you get everything back. Do it once a week. Saved connector keys are not copied (for safety) — you would type them again.'),
    age,
    h('div.row-actions', drives, h('button.btn.sm', { type: 'button', onclick: () => refresh().catch(errorToast) }, icon('refresh', 14), 'Refresh')),
    folder,
    h('label.toggle', autoCopy, h('span.track'), h('span', 'Also copy every automatic backup here', h('small.muted', ' — good for an always-connected disk or a OneDrive/Google Drive folder'))),
    h('div.row-actions',
      h('button.btn.primary', { type: 'button', onclick: async () => {
        if (!target()) return toast('Plug in a USB stick and press Refresh, or type a folder', 'warn');
        try {
          const r = await post('/api/backups/copy', { folder: target() });
          await put('/api/settings/backup', { values: { externalDir: autoCopy.checked ? target() : '' } });
          toast(`Backup copied to ${r.folder}`, 'success', 6000); refresh();
        } catch (e) { errorToast(e); }
      } }, icon('download', 16), 'Back up to USB / folder')));
}

async function restartNow() {
  try { await post('/api/system/restart'); toast('Restarting…', 'info'); setTimeout(() => location.reload(), 5000); } catch (e) { errorToast(e); }
}

function updatesCard() {
  const box = h('div');
  const file = h('input', { type: 'file', accept: '.posupdate' });
  const load = async () => {
    const u = await get('/api/updates');
    box.replaceChildren(
      h('div.meta-grid', h('div', h('small', 'Installed version'), h('b', u.version)),
        h('div', h('small', 'Last change'), u.lastChange ? `${u.lastChange.kind} ${u.lastChange.from} → ${u.lastChange.to}` : '—'),
        h('div', h('small', 'Update check'), u.hasKey ? badge('Signed updates only', 'ok') : badge('No update key', 'warn'))),
      u.lastChange?.kind === 'auto-rollback' ? h('p.danger-text', `Version ${u.lastChange.from} failed to start, so ${u.lastChange.to} was put back automatically.`) : null,
      !u.installedCopy ? h('p.hint', 'This is the source version. Updates install into the released app built with “npm run build”.') : null,
      u.pending ? h('div.integrity.bad', icon('refresh', 18), h('div', h('b', `Update ${u.pending.version} is ready. `), 'Restart to install it. ', h('button.btn.sm', { onclick: restartNow }, 'Restart now'))) : null,
      u.rollbackTo.length ? h('div.row-actions', h('span.muted', 'Roll back to:'), ...u.rollbackTo.map((v) => h('button.btn.sm', { onclick: async () => {
        if (!(await confirmDialog(`Go back to version ${v}? Your data is backed up first.`, { okLabel: 'Roll back', danger: true }))) return;
        try { await post('/api/updates/rollback', { to: v }); toast('Rollback ready', 'success'); await restartNow(); } catch (e) { errorToast(e); }
      } }, v))) : null,
      u.downloaded && !u.pending ? h('div.integrity.ok', icon('download', 18), h('div', h('b', `Version ${u.downloaded} is downloaded and verified. `), u.check.latestNotes ? `${u.check.latestNotes} ` : '',
        h('button.btn.sm.primary', { onclick: async () => { try { await post('/api/updates/install-downloaded'); await restartNow(); } catch (e) { errorToast(e); } } }, 'Install & restart'))) : null,
      checkBox(u));
  };
  const checkBox = (u) => {
    const on = h('input', { type: 'checkbox', checked: !!u.check.autoCheck });
    const url = h('input.input', { type: 'url', value: u.check.manifestUrl || '', placeholder: 'https://raw.githubusercontent.com/you/your-repo/main/updates/latest.json' });
    return h('div.form-grid',
      h('h4', 'Check for updates automatically'),
      h('p.hint', 'Off by default. When on, the POS asks one address of your choice — and nothing else — once a day. A new version is downloaded and its signature checked; you still choose when to install. Last check: ', u.check.lastCheckAt ? `${new Date(u.check.lastCheckAt).toLocaleString()} (latest ${u.check.latestVersion})` : 'never', '.'),
      h('label.toggle', on, h('span.track'), h('span', 'Check once a day')),
      field('Update address (latest.json)', url),
      h('div.row-actions',
        h('button.btn', { onclick: async () => { try { await put('/api/settings/updates', { values: { autoCheck: on.checked, manifestUrl: url.value.trim() } }); toast('Saved', 'success'); } catch (e) { errorToast(e); } } }, 'Save'),
        h('button.btn', { onclick: async () => {
          try {
            await put('/api/settings/updates', { values: { autoCheck: on.checked, manifestUrl: url.value.trim() } });
            const r = await post('/api/updates/check');
            toast(r.available ? `Version ${r.latest} downloaded and verified` : `You have the latest version (${r.current})`, r.available ? 'success' : 'info', 6000); load();
          } catch (e) { errorToast(e); }
        } }, icon('refresh', 14), 'Check now')));
  };
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const res = await fetch('/api/updates/upload', { method: 'POST', headers: { 'X-POS-Client': '1', 'Content-Type': 'application/octet-stream' }, body: f });
      const x = await res.json();
      if (!res.ok) throw new Error(x.message);
      toast(`Update ${x.version} verified and ready${x.notes ? ': ' + x.notes : ''}`, 'success', 6000); load();
    } catch (e) { errorToast(e); }
    file.value = '';
  });
  load().catch(errorToast);
  return h('section.card',
    h('header.card-head', h('h3', icon('upload', 18), 'Updates')),
    h('p.hint', 'Install a new version from a signed .posupdate file. Only files signed with your update key are accepted; your data is backed up first, the previous version is kept, and a version that fails to start is rolled back automatically.'),
    h('label.btn.primary', icon('upload', 16), 'Install update file…', file), box);
}

/** Start with the computer + shut down. */
function systemCard() {
  const auto = h('input', { type: 'checkbox' });
  const where = h('small.muted');
  get('/api/system/autostart').then((r) => { auto.checked = r.enabled; where.textContent = r.enabled ? ` — added to ${r.where}` : ''; }).catch(errorToast);
  auto.addEventListener('change', async () => {
    try { const r = await put('/api/system/autostart', { enabled: auto.checked }); where.textContent = r.enabled ? ` — added to ${r.where}` : ''; toast(r.enabled ? 'The POS will start when this computer starts' : 'Turned off', 'success'); } catch (e) { auto.checked = !auto.checked; errorToast(e); }
  });
  return h('section.card',
    h('header.card-head', h('h3', icon('gear', 18), 'This computer')),
    h('label.toggle', auto, h('span.track'), h('span', 'Start the POS when this computer starts', where)),
    h('p.hint', 'It starts quietly in the background; open it from the desktop icon or the bookmark. Nothing is installed system-wide.'),
    h('div.row-actions',
      h('button.btn', { onclick: restartNow }, icon('refresh', 16), 'Restart the POS'),
      h('button.btn.danger', { onclick: async () => {
        if (!(await confirmDialog('Shut down the POS? Open bills are kept. Start it again from the desktop icon.', { okLabel: 'Shut down', danger: true }))) return;
        try { await post('/api/system/shutdown'); document.body.replaceChildren(h('main.login', h('div.login-card', h('h1', 'The POS is shut down'), h('p', 'Start it again from the Free AI POS icon.')))); } catch (e) { errorToast(e); }
      } }, 'Shut down the POS')));
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
  return h('section.card',
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


// ---------- Appearance: 15 built-in themes + custom themes from your own pictures ----------
function appearanceCard() {
  const grid = h('div.theme-grid');
  const sound = h('input', { type: 'checkbox', checked: getState().boot.settings.ui.sound !== false });
  sound.addEventListener('change', () => put('/api/settings/ui', { values: { sound: sound.checked } }).catch(errorToast));
  const touch = h('input', { type: 'checkbox', checked: !!getState().boot.settings.ui.touchMode });
  touch.addEventListener('change', async () => {
    document.body.classList.toggle('touch', touch.checked);
    try { await put('/api/settings/ui', { values: { touchMode: touch.checked } }); dispatch({ type: 'boot', boot: await get('/api/bootstrap') }); } catch (e) { errorToast(e); }
  });

  const preview = (attrs, label, extra) => h('div.tt-preview', attrs, h('div.tt-nav', h('i'), h('i'), h('i'), h('i')),
    h('div.tt-body', h('div.tt-card', h('b'), h('span')), h('div.tt-row', h('i'), h('i'), h('i')), extra || null));

  async function choose(theme, custom) {
    applyTheme(theme, custom);
    try {
      await put('/api/settings/ui', { values: { theme } });
      dispatch({ type: 'boot', boot: await get('/api/bootstrap') });
      draw();
    } catch (e) { errorToast(e); }
  }

  async function draw() {
    const current = getState().boot.settings.ui.theme || 'system';
    let custom = [];
    try { custom = (await get('/api/themes')).custom; } catch (e) { errorToast(e); }
    grid.replaceChildren(
      h(`button.theme-tile${current === 'system' ? '.active' : ''}`, { onclick: () => choose('system') },
        h('div.tt-preview', { style: { gridTemplateColumns: '1fr 1fr' } }, h('div', { 'data-theme': 'light', style: { background: 'var(--bg)' } }, preview({ 'data-theme': 'light', style: { height: '100%', border: '0', borderRadius: '0' } })), h('div', { 'data-theme': 'dark' }, preview({ 'data-theme': 'dark', style: { height: '100%', border: '0', borderRadius: '0' } }))),
        h('span.tt-name', 'Match system', current === 'system' ? icon('check', 14) : null)),
      ...THEMES.map((t) => h(`button.theme-tile${current === t.id ? '.active' : ''}`, { onclick: () => choose(t.id), 'aria-pressed': current === t.id },
        preview({ 'data-theme': t.id }), h('span.tt-name', t.label, current === t.id ? icon('check', 14) : null))),
      ...custom.map((t) => {
        const id = `custom:${t.id}`;
        const vars = Object.fromEntries(VAR_KEYS.map((k) => [`--${k}`, t.vars[k]]));
        const pv = preview({ style: vars });
        if (t.hasImage) pv.style.backgroundImage = `linear-gradient(color-mix(in srgb, ${t.vars.bg} ${100 - t.imageStrength}%, transparent), color-mix(in srgb, ${t.vars.bg} ${100 - t.imageStrength}%, transparent)), url("/api/themes/${t.id}/image")`;
        return h(`div.theme-tile${current === id ? '.active' : ''}`, { role: 'button', tabIndex: 0, onclick: () => choose(id, t), onkeydown: (e) => { if (e.key === 'Enter') choose(id, t); } },
          pv, h('span.tt-name', h('span', t.hasImage ? '🖼 ' : '🎨 ', t.name),
            h('span.tt-actions',
              h('button.icon-btn.sm', { 'aria-label': `Edit ${t.name}`, onclick: (e) => { e.stopPropagation(); themeBuilder(t, draw, choose); } }, icon('edit', 14)),
              h('button.icon-btn.sm', { 'aria-label': `Delete ${t.name}`, onclick: async (e) => {
                e.stopPropagation();
                if (!(await confirmDialog(`Delete theme "${t.name}"?`, { danger: true, okLabel: 'Delete' }))) return;
                await del(`/api/themes/${t.id}`);
                if (current === id) applyTheme('system');
                dispatch({ type: 'boot', boot: await get('/api/bootstrap') }); draw();
              } }, icon('trash', 14)))));
      }),
      h('button.theme-tile.add', { onclick: () => themeBuilder(null, draw, choose) }, icon('plus', 22), 'Create from picture'));
  }
  draw();
  return h('section.card',
    h('header.card-head', h('h3', icon('moon', 18), 'Appearance'), h('div.row-actions', h('label.toggle', touch, h('span.track'), h('span', 'Touch mode (bigger buttons)')), h('label.toggle', sound, h('span.track'), h('span', 'Payment chime')))),
    h('p.hint', 'Pick one of 15 themes, or create your own from a picture — the POS reads its colours, picks a readable accent, and can show the picture behind the screens.'),
    grid);
}

function themeBuilder(existing, done, choose) {
  let vars = existing ? { ...existing.vars } : paletteFromHue(170, 0.7, 'light');
  let mode = existing?.mode || 'light';
  let image = existing?.hasImage ? `/api/themes/${existing.id}/image` : null; // display URL
  let upload;          // new data URL to send (undefined = keep, null = remove)
  let img = null;      // decoded picture for re-analysis
  let strength = existing?.imageStrength ?? 25;
  let hue = null;

  const name = h('input.input', { value: existing?.name || '', placeholder: 'e.g. My shop front' });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const modeSel = h('select.input', ['auto', 'light', 'dark'].map((m) => h('option', { value: m, selected: existing ? m === mode : m === 'auto' }, m === 'auto' ? 'Auto (from picture)' : m)));
  const useBg = h('input', { type: 'checkbox', checked: !!image });
  const slider = h('input', { type: 'range', min: 0, max: 80, value: strength, 'aria-label': 'Picture strength' });
  const accentIn = h('input', { type: 'color', value: vars.accent });
  const big = h('div.tt-preview.photo-preview', { style: { height: '200px', gridTemplateColumns: '18% 1fr' } },
    h('div.tt-nav', h('i'), h('i'), h('i'), h('i'), h('i')),
    h('div.tt-body', h('div.tt-card', h('b'), h('span')), h('div.tt-card', h('b'), h('span')), h('div.tt-row', h('i'), h('i'), h('i'), h('i')),
      h('div', { style: { display: 'flex', gap: '6px' } }, h('span.btn.sm.primary', 'Charge'), h('span.btn.sm', 'Discount'), h('span.badge.ok', 'Paid'))));
  const advanced = h('div.palette-row');
  const warn = h('small.hint');

  const regenerate = () => {
    const m = modeSel.value === 'auto' ? undefined : modeSel.value;
    if (hue !== null) { mode = m || mode; vars = paletteFromHue(hue.h, hue.s, mode); }
    else if (img) { const p = paletteFromImage(img, m); mode = p.mode; vars = p.vars; }
    else { mode = m || 'light'; vars = paletteFromHue(170, 0.7, mode); }
    accentIn.value = vars.accent;
    paint();
  };
  const paint = () => {
    for (const k of VAR_KEYS) big.style.setProperty(`--${k}`, vars[k]);
    big.style.backgroundImage = image && useBg.checked
      ? `linear-gradient(color-mix(in srgb, ${vars.bg} ${100 - slider.value}%, transparent), color-mix(in srgb, ${vars.bg} ${100 - slider.value}%, transparent)), url("${image}")` : '';
    advanced.replaceChildren(...VAR_KEYS.map((k) => {
      const inp = h('input', { type: 'color', value: vars[k], 'aria-label': k });
      inp.addEventListener('input', () => { vars[k] = inp.value; hue = null; paint(); });
      return h('label', inp, k);
    }));
    const c = contrast(vars.text, vars.bg), a = contrast(vars['accent-ink'], vars.accent);
    warn.textContent = c < 4.5 || a < 4.5 ? `⚠ Low contrast (text ${c.toFixed(1)}:1, buttons ${a.toFixed(1)}:1) — aim for 4.5:1 or more.` : `Contrast OK (text ${c.toFixed(1)}:1, buttons ${a.toFixed(1)}:1).`;
  };

  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const p = await prepareImage(f);
      upload = p.dataUrl; image = p.dataUrl; img = p.canvas; hue = null; useBg.checked = true;
      if (!name.value) name.value = f.name.replace(/\.[^.]+$/, '').slice(0, 40);
      regenerate();
    } catch (e) { errorToast(e); }
  });
  modeSel.addEventListener('change', regenerate);
  slider.addEventListener('input', paint);
  useBg.addEventListener('change', paint);
  accentIn.addEventListener('input', () => {
    const hex = accentIn.value; const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    const s2 = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    const hh = d === 0 ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    hue = { h: (hh + 360) % 360, s: Math.max(0.35, s2) }; regenerate();
  });
  paint();

  modal({
    title: existing ? `Edit theme · ${existing.name}` : 'Create a theme from your picture', wide: true,
    body: h('div.form-grid',
      big,
      h('div.form-grid.two', field('Picture', file, 'JPEG/PNG/WebP. Resized on this PC; location data is removed.'), field('Theme name', name)),
      h('div.form-grid.two', field('Light or dark', modeSel), field('Accent colour', accentIn, 'Pick one to rebuild the palette around it')),
      h('div.form-grid.two', h('label.toggle', useBg, h('span.track'), h('span', 'Show the picture as background')), field('Picture strength', slider)),
      warn,
      h('details', h('summary', 'Fine-tune every colour'), advanced)),
    actions: [
      { label: 'Cancel', onClick: (c) => c() },
      { label: existing ? 'Save & use' : 'Create & use', primary: true, onClick: async (c) => {
        if (!name.value.trim()) return toast('Give the theme a name', 'warn');
        const body = { name: name.value, mode, vars, imageStrength: Number(slider.value) };
        if (!useBg.checked) body.image = null; else if (upload !== undefined) body.image = upload;
        try {
          const t = existing ? await put(`/api/themes/${existing.id}`, body) : await post('/api/themes', body);
          c(); toast('Theme saved', 'success');
          await choose(`custom:${t.id}`, t); done();
        } catch (e) { errorToast(e); }
      } }],
  });
}

// ---------- Privacy: what may leave this PC, and what actually did ----------
const WHAT_LEAVES = {
  esewa: 'bill number and amount (to verify the payment)',
  khalti: 'bill number, amount, and the customer name/phone if entered',
  stripe: 'bill number and amount',
  ird: 'invoice totals, your PAN and the buyer PAN (legal requirement)',
  google: 'event titles and dates you create',
  ai: 'your questions plus this month\'s sales totals and item list (no customer details, no keys)',
  telegram: 'bill number, amount and payment method',
};
function privacyCard() {
  const off = h('input', { type: 'checkbox' });
  const allowed = h('ul.rank');
  const log = h('ul.egress-list');
  const load = async () => {
    try {
      const r = await get('/api/privacy/egress');
      off.checked = r.offline;
      const byConn = {};
      for (const d of r.allowed) (byConn[d.connector] ||= []).push(d.host);
      allowed.replaceChildren(...(Object.keys(byConn).length ? Object.entries(byConn).map(([c, hosts]) => h('li', h('b', c), h('small.muted', ` ${hosts.join(', ')}`), h('small', { style: { marginLeft: 'auto', textAlign: 'right' } }, WHAT_LEAVES[c] || ''))) : [h('li.muted', 'Nothing — no connector is switched on, so nothing leaves this computer.')]));
      log.replaceChildren(...(r.recent.length ? r.recent.slice(0, 60).map((e) => h('li', h('time', new Date(e.at).toLocaleTimeString()), h('code', e.host), h('span', e.purpose), e.blocked ? badge('blocked', 'bad') : e.error ? badge(e.error, 'warn') : badge(String(e.status), e.status < 400 ? 'ok' : 'warn'))) : [h('li.muted', 'No outbound connections since the POS started.')]));
    } catch (e) { errorToast(e); }
  };
  off.addEventListener('change', async () => {
    try { await put('/api/settings/privacy', { values: { offline: off.checked } }); toast(off.checked ? 'Offline: nothing can leave this computer' : 'Online: enabled connectors may connect', 'success'); load(); }
    catch (e) { off.checked = !off.checked; errorToast(e); }
  });
  load();
  return h('section.card',
    h('header.card-head', h('h3', icon('shield', 18), 'Privacy — what leaves this PC'), h('button.btn.sm', { onclick: load }, icon('refresh', 14), 'Refresh')),
    h('p.hint', 'The server only connects to services you switched on, over HTTPS, without revealing anything about this computer (no OS, device or software details, no referrer). Each saved key can only be sent to its own provider; a key headed anywhere else — or a POS API key leaving at all — is blocked and logged. The screen never loads anything from other websites.'),
    h('label.toggle', off, h('span.track'), h('span', h('b', 'Offline mode'), ' — block every outbound connection (cash/card/QR selling keeps working)')),
    h('h4', 'Allowed destinations and what is sent'), allowed,
    h('h4', 'Outbound activity (since start)'), log);
}

// ---------- Moving from another system ----------
function migrationCard() {
  const kindSel = h('select.input', { 'aria-label': 'What to import' });
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.json,text/csv,application/json' });
  const stage = h('div.form-grid');
  let text = '', pv = null;
  get('/api/migrate/kinds').then((k) => kindSel.replaceChildren(...Object.entries(k).map(([id, v]) => h('option', { value: id }, v.label)))).catch(errorToast);
  const reset = () => { stage.replaceChildren(); pv = null; };
  kindSel.addEventListener('change', () => { if (text) previewNow(); });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { toast('Save the spreadsheet as CSV first (File → Save As → CSV)', 'warn', 6000); return; }
    text = await f.text(); previewNow();
  });
  async function previewNow() {
    reset();
    try { pv = await post('/api/migrate/preview', { kind: kindSel.value, text }); } catch (e) { return errorToast(e); }
    const selects = Object.fromEntries(pv.fields.map((f) => [f, h('select.input', h('option', { value: '' }, '— skip —'), pv.columns.map((c) => h('option', { value: c, selected: pv.mapping[f] === c }, c)))]));
    const result = h('div');
    const go = async (dryRun) => {
      const mapping = Object.fromEntries(Object.entries(selects).map(([f, el]) => [f, el.value]).filter(([, v]) => v));
      try {
        const r = await post('/api/migrate/run', { kind: pv.kind, text, mapping, dryRun });
        result.replaceChildren(h(`div.integrity.${r.errorCount ? 'bad' : 'ok'}`, icon(r.errorCount ? 'x' : 'check', 18), h('div',
          h('b', dryRun ? 'Dry run (nothing saved): ' : 'Imported: '), `${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} already imported` : ''}, ${r.errorCount} with problems of ${r.rows} rows.`,
          r.errors.length ? h('ul', r.errors.slice(0, 8).map((e) => h('li', `Row ${e.row}: ${e.error}`))) : null)));
        if (!dryRun) { toast('Import finished', 'success'); dispatch({ type: 'boot', boot: await get('/api/bootstrap') }); }
      } catch (e) { errorToast(e); }
    };
    stage.replaceChildren(
      h('p.hint', `${pv.rowCount} rows found. Match each field to a column in your file (guessed automatically).`),
      h('div.form-grid.two', pv.fields.map((f) => field(`${f}${pv.required.includes(f) ? ' *' : ''}`, selects[f]))),
      h('details', h('summary', 'Preview first rows'), h('div.table-wrap', h('table.table.compact', h('thead', h('tr', pv.columns.map((c) => h('th', c)))),
        h('tbody', pv.sample.slice(0, 8).map((r) => h('tr', pv.columns.map((c) => h('td', r[c])))))))),
      h('div.row-actions', h('button.btn', { onclick: () => go(true) }, 'Dry run'), h('button.btn.primary', { onclick: async () => {
        if (await confirmDialog(`Import ${pv.rowCount} rows now? A backup is a good idea first.`, { okLabel: 'Import' })) go(false);
      } }, 'Import')),
      result);
  }
  return h('section.card',
    h('header.card-head', h('h3', icon('upload', 18), 'Move from another system')),
    h('p.hint', 'Bring items, customers, opening stock or past sales from your old POS or spreadsheet (CSV, TSV or JSON export). Past sales are kept as history: they appear in reports but are never sent to IRD again.'),
    h('div.form-grid.two', field('What are you importing?', kindSel), h('label.btn', { style: { alignSelf: 'end' } }, icon('upload', 16), 'Choose export file…', file)),
    stage);
}

/** Optional: seal the master key so the POS needs the PIN after every start. */
function sealControls() {
  const box = h('div');
  const draw = async () => {
    const st = await get('/api/security/seal');
    const pin = h('input.input', { type: 'password', inputMode: 'numeric', placeholder: 'PIN' });
    const key = h('input.input.mono', { type: 'password', autocomplete: 'off', placeholder: 'Owner Key (recovery if the PIN is forgotten)' });
    box.replaceChildren(h('h4', 'Require the PIN at every start'),
      h('p.hint', st.sealed
        ? `On. The key that protects your saved keys and audit log is sealed with the PIN${st.ownerRecovery ? ' and the Owner Key' : ''}; copying the data folder alone reveals nothing. Backups need the PIN or Owner Key to be useful.`
        : 'Off. Turn on to seal the key that protects your saved keys and audit log. After every restart the POS stays locked until someone enters the PIN (or the Owner Key).'),
      st.sealed
        ? h('div.row-actions', pin, h('button.btn', { onclick: async () => { try { await post('/api/security/unseal-off', { pin: pin.value }, { noPinRetry: true }); toast('PIN at start turned off', 'success'); draw(); } catch (e) { errorToast(e); } } }, 'Turn off'))
        : h('div.form-grid.two', pin, key, h('button.btn.primary', { onclick: async () => {
          if (!(await confirmDialog('Seal the keys? From now on the POS asks for the PIN after every restart. Keep your Owner Key safe — it is the only other way in.', { okLabel: 'Seal keys' }))) return;
          try { await post('/api/security/seal', { pin: pin.value, ownerKey: key.value }, { noPinRetry: true }); toast('Keys sealed', 'success'); draw(); } catch (e) { errorToast(e); }
        } }, icon('lock', 16), 'Turn on')));
  };
  draw().catch(errorToast);
  return box;
}

async function applyExtensions() {
  const boot = await get('/api/bootstrap');
  dispatch({ type: 'boot', boot });
  await reloadExtensions(boot.extensions);
}
