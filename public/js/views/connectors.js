// Connectors: bring-your-own-key integrations. Secrets are write-only from the browser's view.
import { h, icon, toast, errorToast, modal, field, badge, confirmDialog, fmtDate } from '../ui.js';
import { get, put, post, del } from '../api.js';
import { getState, dispatch } from '../store.js';

const SPECS = [
  { group: 'esewa', title: 'eSewa', icon: 'wallet', section: 'Payments', desc: 'ePay v2 checkout. Sandbox works out of the box with eSewa\'s public test merchant.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'sandbox', type: 'toggle', label: 'Sandbox (test) mode' },
      { name: 'productCode', label: 'Merchant / product code', hint: 'EPAYTEST in sandbox' }, { name: 'secretKey', type: 'secret', label: 'Secret key', hint: 'Leave blank in sandbox to use the public test key' }], test: true },
  { group: 'khalti', title: 'Khalti', icon: 'wallet', section: 'Payments', desc: 'KPG-2 payment links with automatic lookup verification.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'sandbox', type: 'toggle', label: 'Sandbox (dev.khalti.com)' }, { name: 'secretKey', type: 'secret', label: 'Live/Test secret key' }], test: true },
  { group: 'stripe', title: 'Stripe', icon: 'link', section: 'Payments', desc: 'Stripe Checkout links for international cards. Verified by polling; the webhook is optional.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'secretKey', type: 'secret', label: 'Secret key (sk_…)' },
      { name: 'webhookSecret', type: 'secret', label: 'Webhook signing secret (whsec_…)', hint: 'Only if you expose the POS via a tunnel: POST /api/webhooks/stripe' },
      { name: 'currency', label: 'Charge currency', hint: 'e.g. usd, eur, npr' }, { name: 'fxRate', type: 'number', label: 'Exchange rate', hint: 'Multiply bill amount by this to get the Stripe amount (1 if same currency)' }], test: true },
  { group: 'qr', title: 'Fonepay / Bank QR', icon: 'qr', section: 'Payments', desc: 'Show your static merchant QR at checkout. Confirm manually, or automatically via the signed webhook below.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'label', label: 'Button label' }, { name: 'payload', label: 'QR text (decoded from your merchant QR)' }, { name: 'imageUrl', label: 'Or an image URL / data: URL of the QR' }] },
  { group: 'card', title: 'Card terminal', icon: 'receipt', section: 'Payments', desc: 'Record card payments taken on a separate terminal.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'label', label: 'Button label' }] },
  { group: 'genericWebhook', title: 'Payment notification webhook', icon: 'bell', section: 'Payments', desc: 'Any service (bank SMS forwarder, Zapier, n8n, your own script) can confirm a payment by POSTing a signed JSON body.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Accept signed notifications' }], test: true, extra: webhookExtra },
  { group: 'ird', title: 'IRD Nepal (CBMS)', icon: 'shield', section: 'Tax & billing', desc: 'Report each paid bill to the Central Billing Monitoring System; void bills send a credit note. Starts in dry-run.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'IRD registration enabled' }, { name: 'autoSync', type: 'toggle', label: 'Sync automatically when a bill is paid' },
      { name: 'dryRun', type: 'toggle', label: 'Dry run (build payloads, send nothing)' }, { name: 'sellerPan', label: 'Seller PAN' }, { name: 'username', label: 'CBMS username' },
      { name: 'password', type: 'secret', label: 'CBMS password' }, { name: 'billUrl', label: 'Bill endpoint' }, { name: 'returnUrl', label: 'Bill-return endpoint' }], test: true, testLabel: 'Preview payload' },
  { group: 'google', title: 'Google Calendar', icon: 'calendar', section: 'Productivity', desc: 'Use your own OAuth client. See upcoming events on Overview, post day-close summaries, optionally log every sale.',
    fields: [{ name: 'clientId', label: 'OAuth client ID' }, { name: 'clientSecret', type: 'secret', label: 'OAuth client secret' }, { name: 'calendarId', label: 'Calendar ID', hint: '"primary" or a calendar\'s ID' },
      { name: 'logSales', type: 'toggle', label: 'Add every paid sale as an event' }], extra: googleExtra },
  { group: 'ai', title: 'AI Copilot (Anthropic)', icon: 'sparkles', section: 'Productivity', desc: 'Bring your own Anthropic API key for the copilot and the AI feature builder. The key stays on this PC.',
    fields: [{ name: 'apiKey', type: 'secret', label: 'Anthropic API key' }, { name: 'model', label: 'Model', hint: 'Default: claude-opus-5-5' },
      { name: 'effort', type: 'select', label: 'Effort', options: ['low', 'medium', 'high', 'xhigh', 'max'], hint: 'Higher = more thorough, slower, more tokens' }], test: true },
  { group: 'telegram', title: 'Telegram alerts', icon: 'send', section: 'Productivity', desc: 'Get a message on your phone for every paid sale.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'botToken', type: 'secret', label: 'Bot token (from @BotFather)' }, { name: 'chatId', label: 'Chat ID' }, { name: 'notifyPaid', type: 'toggle', label: 'Notify on paid sales' }], test: true },
];

export function renderConnectors(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (params.get('google') === 'connected') toast('Google Calendar connected', 'success');
  if (params.get('google') === 'denied') toast('Google access was denied', 'warn');
  const settings = getState().boot.settings;
  const sections = [...new Set(SPECS.map((s) => s.section))];
  root.replaceChildren(h('div.connectors',
    h('p.lead', 'Plug in your own accounts and keys. Everything is stored on this computer, secrets encrypted at rest.'),
    ...sections.map((sec) => h('section', h('h2.section-title', sec), h('div.conn-grid', SPECS.filter((s) => s.section === sec).map((s) => connectorCard(s, settings[s.group]))))),
    h('section', h('h2.section-title', 'Developer'), h('div.conn-grid.wide', apiKeysCard(), outboundCard()))));
}

const isOn = (spec, cfg) => (spec.group === 'google' ? getState().boot.google.connected : spec.group === 'ai' ? cfg.apiKeySet : cfg.enabled);

function connectorCard(spec, cfg) {
  const form = h('form.conn-form', { onsubmit: (e) => e.preventDefault() });
  const inputs = {};
  for (const f of spec.fields) {
    let el;
    if (f.type === 'toggle') { el = h('input', { type: 'checkbox', checked: !!cfg[f.name] }); form.append(h('label.toggle', el, h('span.track'), h('span', f.label))); }
    else {
      if (f.type === 'select') el = h('select.input', f.options.map((o) => h('option', { value: o, selected: cfg[f.name] === o }, o)));
      else if (f.type === 'secret') el = h('input.input', { type: 'password', autocomplete: 'off', placeholder: cfg[`${f.name}Set`] ? "Saved (hidden) — type to replace" : 'Not set' });
      else el = h('input.input', { type: f.type === 'number' ? 'number' : 'text', step: 'any', value: cfg[f.name] ?? '' });
      form.append(field(f.label, el, f.hint));
    }
    inputs[f.name] = el;
  }
  const status = h('span');
  const setStatus = (c) => status.replaceChildren(isOn(spec, c) ? badge('On', 'ok') : badge('Off'));
  setStatus(cfg);
  const save = async () => {
    const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
    try {
      const updated = await put(`/api/settings/${spec.group}`, { values });
      const boot = await get('/api/bootstrap');
      dispatch({ type: 'boot', boot });
      for (const f of spec.fields) if (f.type === 'secret') { inputs[f.name].value = ''; inputs[f.name].placeholder = updated[`${f.name}Set`] ? "Saved (hidden) — type to replace" : 'Not set'; }
      setStatus(updated);
      toast(`${spec.title} saved`, 'success');
    } catch (e) { errorToast(e); }
  };
  const test = async () => {
    try {
      const r = await post(`/api/connectors/${spec.group}/test`);
      if (r.preview || r.exampleBody) modal({ title: `${spec.title} — test`, wide: true, body: h('div', r.note ? h('p', r.note) : null, h('pre.code', JSON.stringify(r, null, 2))) });
      else toast(r.reply ? `Connected — model says "${r.reply}"` : r.note || 'Test passed', 'success', 5000);
    } catch (e) { errorToast(e); }
  };
  return h('article.conn-card',
    h('header.conn-head', h('div.conn-icon', icon(spec.icon, 22)), h('div', h('h3', spec.title), h('p.muted', spec.desc)), status),
    form, spec.extra ? spec.extra(cfg) : null,
    h('footer.conn-actions', spec.test ? h('button.btn', { type: 'button', onclick: test }, spec.testLabel || 'Test') : null, h('button.btn.primary', { type: 'button', onclick: save }, 'Save')));
}

function webhookExtra() {
  const url = `${getState().boot.baseUrl}/api/webhooks/generic`;
  return h('div.extra',
    h('p.hint', 'Sign the raw body with HMAC-SHA256 using the secret and send it as X-POS-Signature (hex). Localhost isn\'t reachable from the internet; use a tunnel (e.g. cloudflared) and set Public URL in Settings.'),
    h('pre.code', `POST ${url}\nX-POS-Signature: <hmac_sha256_hex(body, secret)>\n\n{"invoice_no":"INV-8384-00012","amount":450,"reference":"FP123456","status":"success"}`),
    h('button.btn.sm', { type: 'button', onclick: async () => {
      if (!(await confirmDialog('Generate a new secret? The old one stops working immediately.'))) return;
      const r = await post('/api/connectors/genericWebhook/rotate');
      modal({ title: 'New webhook secret', body: h('div', h('p', 'Copy it now — it will not be shown again.'), h('pre.code.select', r.secret)) });
    } }, icon('key', 14), 'Generate secret'));
}

function googleExtra() {
  const box = h('div.extra');
  get('/api/google/status').then((s) => {
    box.replaceChildren(
      h('p.hint', 'In Google Cloud Console → APIs & Services: enable the Calendar API, create an OAuth client (Web application) and add this redirect URI:'),
      h('pre.code.select', s.redirectUri),
      s.connected
        ? h('div.row-actions', badge('Connected', 'ok'), h('button.btn.sm', { type: 'button', onclick: async () => { await post('/api/google/disconnect'); dispatch({ type: 'boot', boot: await get('/api/bootstrap') }); renderConnectors(document.querySelector('#view')); } }, 'Disconnect'))
        : h('a.btn.sm.primary', { href: '/api/google/connect' }, icon('calendar', 14), 'Connect Google Calendar'));
  }).catch(errorToast);
  return box;
}

function apiKeysCard() {
  const list = h('ul.keys');
  const load = async () => {
    const keys = await get('/api/keys');
    list.replaceChildren(...(keys.length ? keys.map((k) => h('li', h('div', h('b', k.name), h('small.muted', ` ${k.prefix}… · ${k.scopes.join(', ')} · ${k.last_used ? 'used ' + fmtDate(k.last_used) : 'never used'}`)),
      k.revoked ? badge('Revoked', 'bad') : h('button.btn.sm.danger', { onclick: async () => { if (await confirmDialog(`Revoke "${k.name}"?`, { danger: true, okLabel: 'Revoke' })) { await del(`/api/keys/${k.id}`); load(); } } }, 'Revoke'))) : [h('li.muted', 'No API keys yet.')]));
  };
  load().catch(errorToast);
  const create = () => {
    const name = h('input.input', { placeholder: 'e.g. Website, Inventory sync' });
    const read = h('input', { type: 'checkbox', checked: true }), write = h('input', { type: 'checkbox' });
    modal({ title: 'New API key', body: h('div.form-grid', field('Name', name), h('label.toggle', read, h('span.track'), h('span', 'read (GET items, sales, overview)')), h('label.toggle', write, h('span.track'), h('span', 'write (create items, sales, payments)'))),
      actions: [{ label: 'Create', primary: true, onClick: async (c) => {
        try {
          const k = await post('/api/keys', { name: name.value, scopes: [read.checked && 'read', write.checked && 'write'].filter(Boolean) });
          c(); load();
          modal({ title: 'Your new API key', body: h('div', h('p', 'Copy it now — only a hash is stored, so it can\'t be shown again.'), h('pre.code.select', k.key),
            h('pre.code', `curl -H "Authorization: Bearer ${k.key}" ${getState().boot.baseUrl}/api/items`)) });
        } catch (e) { errorToast(e); }
      } }] });
  };
  return h('article.conn-card',
    h('header.conn-head', h('div.conn-icon', icon('key', 22)), h('div', h('h3', 'POS API keys'), h('p.muted', 'Let your own apps read and write POS data over the REST API (Bearer token).')), null),
    list,
    h('details', h('summary', 'Endpoints'), h('pre.code', `GET  /api/items            GET /api/items/:id
POST /api/items            PUT /api/items/:id   DELETE /api/items/:id
POST /api/sales/quote      POST /api/sales      GET /api/sales?from&to&status&q
GET  /api/sales/:id        POST /api/sales/:id/payments {method, amount|tendered}
GET  /api/overview?offset=0   GET /api/payment-methods`)),
    h('footer.conn-actions', h('button.btn.primary', { onclick: create }, icon('plus', 14), 'New key')));
}

function outboundCard() {
  const list = h('ul.keys');
  let events = [];
  const load = async () => {
    const r = await get('/api/webhooks-out');
    events = r.events;
    list.replaceChildren(...(r.hooks.length ? r.hooks.map((w) => h('li', h('div', h('b', w.url), h('small.muted', ` ${w.events.join(', ')}${w.last_status ? ' · last: ' + w.last_status : ''}`)),
      h('button.btn.sm.danger', { onclick: async () => { await del(`/api/webhooks-out/${w.id}`); load(); } }, 'Delete'))) : [h('li.muted', 'No outbound webhooks.')]));
  };
  load().catch(errorToast);
  const create = () => {
    const url = h('input.input', { type: 'url', placeholder: 'https://example.com/pos-hook' });
    const boxes = events.map((e) => [e, h('input', { type: 'checkbox', checked: e === 'sale.paid' })]);
    modal({ title: 'New outbound webhook', body: h('div.form-grid', field('URL', url), h('div.check-grid', boxes.map(([e, b]) => h('label.check', b, e)))),
      actions: [{ label: 'Create', primary: true, onClick: async (c) => {
        try {
          const w = await post('/api/webhooks-out', { url: url.value, events: boxes.filter(([, b]) => b.checked).map(([e]) => e) });
          c(); load();
          modal({ title: 'Signing secret', body: h('div', h('p', 'Verify X-POS-Signature = HMAC-SHA256(body, secret). Copy now:'), h('pre.code.select', w.secret)) });
        } catch (e) { errorToast(e); }
      } }] });
  };
  return h('article.conn-card',
    h('header.conn-head', h('div.conn-icon', icon('send', 22)), h('div', h('h3', 'Outbound webhooks'), h('p.muted', 'Push POS events (sale paid, item changed…) to your own services, signed with HMAC.')), null),
    list, h('footer.conn-actions', h('button.btn.primary', { onclick: create }, icon('plus', 14), 'New webhook')));
}
