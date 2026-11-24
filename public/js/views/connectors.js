// Connectors: bring-your-own-key integrations. Secrets are write-only from the browser's view.
import { h, icon, toast, errorToast, modal, field, badge, confirmDialog, fmtDate } from '../ui.js';
import { thisDevice } from '../device.js';
import { get, put, post, del } from '../api.js';
import { getState, dispatch } from '../store.js';
import { imageInput } from '../ui.js';

const SPECS = [
  { group: 'esewa', steps: ["To practise: keep Sandbox on, tick Enabled and press Save. No account needed.", "For real money: ask eSewa merchant support for your merchant (product) code and secret key.", "Turn Sandbox off, paste both, press Save.", "Make a Rs 10 sale paid with eSewa. The tick turns green when eSewa confirms it."], title: 'eSewa', icon: 'wallet', section: 'payments', desc: 'ePay v2 checkout. Sandbox works out of the box with eSewa\'s public test merchant.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'sandbox', type: 'toggle', label: 'Sandbox (test) mode' },
      { name: 'productCode', label: 'Merchant / product code', hint: 'EPAYTEST in sandbox' }, { name: 'secretKey', type: 'secret', label: 'Secret key', hint: 'Leave blank in sandbox to use the public test key' }], test: true },
  { group: 'khalti', steps: ["Open a Khalti merchant account (test keys come from dev.khalti.com).", "Copy your secret key (live, or test with Sandbox on).", "Paste it here, tick Enabled, press Save, then Test.", "Make a Rs 10 sale paid with Khalti. The tick turns green when Khalti confirms it."], title: 'Khalti', icon: 'wallet', section: 'payments', desc: 'KPG-2 payment links with automatic lookup verification.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'sandbox', type: 'toggle', label: 'Sandbox (dev.khalti.com)' }, { name: 'secretKey', type: 'secret', label: 'Live/Test secret key' }], test: true },
  { group: 'stripe', steps: ["In Stripe: Developers → API keys → copy the Secret key (starts with sk_).", "Set the charge currency and exchange rate.", "Paste, tick Enabled, press Save, then Test.", "Take one small real card payment. The tick turns green when Stripe confirms it."], title: 'Stripe', icon: 'link', section: 'payments', desc: 'Stripe Checkout links for international cards. Verified by polling; the webhook is optional.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'secretKey', type: 'secret', label: 'Secret key (sk_…)' },
      { name: 'webhookSecret', type: 'secret', label: 'Webhook signing secret (whsec_…)', hint: 'Only if you expose the POS via a tunnel: POST /api/webhooks/stripe' },
      { name: 'currency', label: 'Charge currency', hint: 'e.g. usd, eur, npr' }, { name: 'fxRate', type: 'number', label: 'Exchange rate', hint: 'Multiply bill amount by this to get the Stripe amount (1 if same currency)' }], test: true },
  { group: 'qr', steps: ["Photograph your Fonepay / bank QR sticker.", "Upload the picture here (or paste the text inside the QR) and press Save.", "At checkout the customer scans it; press Confirm once the money shows in your bank app."], title: 'Fonepay / Bank QR', icon: 'qr', section: 'payments', desc: 'Show your static merchant QR at checkout. Confirm manually, or automatically via the signed webhook below.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'label', label: 'Button label' }, { name: 'payload', label: 'QR text (decoded from your merchant QR)' }, { name: 'imageUrl', type: 'image', label: 'Or upload the QR picture' }] },
  { group: 'card', steps: ["Tick Enabled and press Save.", "At checkout, choose Card after the customer has paid on your card machine."], title: 'Card terminal', icon: 'receipt', section: 'payments', desc: 'Record card payments taken on a separate terminal.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'label', label: 'Button label' }] },
  { group: 'genericWebhook', steps: ["Only needed if a bank SMS forwarder or automation tool should confirm QR payments for you.", "Press Generate secret and give it to that tool, with the address shown below."], title: 'Payment notification webhook', icon: 'bell', section: 'payments', desc: 'Any service (bank SMS forwarder, Zapier, n8n, your own script) can confirm a payment by POSTing a signed JSON body.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Accept signed notifications' }], test: true, extra: webhookExtra },
  { group: 'ird', steps: ["Easiest: Overview › IRD › Set up IRD walks you through this card.", "Get your CBMS username and password from your accountant or IRD.", "Keep Dry run on, press Save, then Preview payload to see what would be sent.", "When your accountant agrees, turn Dry run off. The tick turns green after the first bill reaches IRD."], title: 'IRD Nepal (CBMS)', icon: 'shield', section: 'tax', desc: 'Report each paid bill to the Central Billing Monitoring System; void bills send a credit note. Starts in dry-run.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'IRD registration enabled' }, { name: 'autoSync', type: 'toggle', label: 'Sync automatically when a bill is paid' },
      { name: 'dryRun', type: 'toggle', label: 'Dry run (build payloads, send nothing)' }, { name: 'sellerPan', label: 'Seller PAN' }, { name: 'username', label: 'CBMS username' },
      { name: 'password', type: 'secret', label: 'CBMS password' }, { name: 'billUrl', label: 'Bill endpoint' }, { name: 'returnUrl', label: 'Bill-return endpoint' }], test: true, testLabel: 'Preview payload' },
  { group: 'google', steps: ["In Google Cloud Console create an OAuth client (Web application) — the redirect address is shown below.", "Paste the client ID and secret here and press Save.", "Press Connect Google Calendar and allow access."], title: 'Google Calendar', icon: 'calendar', section: 'apps', desc: 'Use your own OAuth client. See upcoming events on Overview, post day-close summaries, optionally log every sale.',
    fields: [{ name: 'clientId', label: 'OAuth client ID' }, { name: 'clientSecret', type: 'secret', label: 'OAuth client secret' }, { name: 'calendarId', label: 'Calendar ID', hint: '"primary" or a calendar\'s ID' },
      { name: 'logSales', type: 'toggle', label: 'Add every paid sale as an event' }], extra: googleExtra },
  { group: 'ai', steps: ["Create an API key at console.anthropic.com (needs a payment method there).", "Paste it here, press Save, then Test.", "Open the Copilot with the ✨ button at the top."], title: 'AI Copilot', icon: 'sparkles', section: 'apps', desc: `Bring your own Anthropic API key for the copilot and the AI feature builder. The key stays on ${thisDevice()}.`,
    fields: [{ name: 'apiKey', type: 'secret', label: 'Anthropic API key' }, { name: 'model', label: 'Model', hint: 'Leave as it is unless you need a different model' },
      { name: 'effort', type: 'select', label: 'Effort', options: ['low', 'medium', 'high', 'xhigh', 'max'], hint: 'Higher = more thorough, slower, more tokens' }], test: true },
  { group: 'printer', steps: ["Choose how the printer is connected.", "Network printer: type its IP address (hold the feed button while switching it on to print it). USB: type the printer's name as it appears on this computer.", "Press Save, then Test print."], title: 'Receipt printer', icon: 'printer', section: 'devices', desc: 'Print receipts automatically and open the cash drawer on cash sales.',
    fields: [{ name: 'mode', type: 'select', label: 'Connection', options: ['browser', 'network', 'system'], hint: 'browser = print dialog · network = LAN printer (IP, port 9100) · system = USB printer queue' },
      { name: 'host', label: 'Printer IP (network)', hint: 'Local network only, e.g. 192.168.1.50' }, { name: 'port', type: 'number', label: 'Port (network)' },
      { name: 'queue', label: 'Printer / share name (system)', hint: 'macOS/Linux: printer name from lpstat · Windows: share the printer and enter its share name' },
      { name: 'width', type: 'select', label: 'Characters per line', options: ['48', '42', '32'], hint: '48 for 80 mm, 32 for 58 mm' },
      { name: 'paper', type: 'select', label: 'Browser receipt width (mm)', options: ['80', '58'] },
      { name: 'autoPrint', type: 'toggle', label: 'Print automatically after each paid sale' }, { name: 'openDrawer', type: 'toggle', label: 'Open the cash drawer on cash sales' },
      { name: 'printQr', type: 'toggle', label: 'Print e-bill QR (needs Public URL)' }, { name: 'copies', type: 'number', label: 'Copies' }], extra: printerExtra },
  { group: 'scanner', steps: ["Plug in a USB scanner — nothing else to set up.", "On the Sell screen, scan any product barcode to try it."], title: 'Barcode scanner', icon: 'qr', section: 'devices', desc: 'USB/Bluetooth scanners work anywhere on the sell screen. The camera button scans with a webcam (Chrome/Edge).',
    fields: [{ name: 'beep', type: 'toggle', label: 'Beep on scan' }, { name: 'minLength', type: 'number', label: 'Shortest barcode length' }, { name: 'maxGapMs', type: 'number', label: 'Max ms between scanner keystrokes', hint: 'Raise if scans are missed; lower if fast typing is mistaken for a scan' }], extra: scannerExtra },
  { group: 'telegram', steps: ["In Telegram, message @BotFather, send /newbot and copy the token it gives you.", "Send any message to your new bot, then get your chat ID from @userinfobot.", "Paste both, tick Enabled, press Save, then Test."], title: 'Telegram alerts', icon: 'send', section: 'apps', desc: 'Get a message on your phone for every paid sale.',
    fields: [{ name: 'enabled', type: 'toggle', label: 'Enabled' }, { name: 'botToken', type: 'secret', label: 'Bot token (from @BotFather)' }, { name: 'chatId', label: 'Chat ID' }, { name: 'notifyPaid', type: 'toggle', label: 'Notify on paid sales' }], test: true },
];

const INTRO = {
  payments: 'Payment methods offered at checkout. Online payments are verified automatically; nothing is marked paid on trust.',
  tax: 'Report bills to IRD (CBMS). The step-by-step wizard and filing pack live under Overview → IRD.',
  apps: `Your own Google Calendar, AI key and phone alerts. Keys stay on ${thisDevice()}, encrypted, and are only sent to their own service.`,
  devices: `Receipt printers, cash drawers and barcode scanners connected to ${thisDevice()} or your local network.`,
  developer: 'Let your own scripts and websites talk to the POS: scoped API keys in, signed webhooks out.',
};

/** Connectors sub-pages: payments, tax, apps, devices, developer. */
export function renderConnectors(root, { sub = 'payments', params } = {}) {
  if (params?.get('google') === 'connected') toast('Google Calendar connected', 'success');
  if (params?.get('google') === 'denied') toast('Google access was denied', 'warn');
  const settings = getState().boot.settings;
  const cards = sub === 'developer' ? [apiKeysCard(), outboundCard()] : SPECS.filter((s) => s.section === sub).map((s) => connectorCard(s, settings[s.group]));
  get('/api/connectors/proven').then((p) => {
    for (const el of root.querySelectorAll('[data-proof]')) {
      const at = p[el.dataset.proof];
      el.replaceChildren(at ? badge(`✓ Working — confirmed ${new Date(at).toLocaleDateString()}`, 'ok') : '');
    }
  }).catch(() => {});
  root.replaceChildren(h('div.connectors',
    h('p.lead', INTRO[sub] || ''),
    h(`div.conn-grid${sub === 'developer' ? '.wide' : ''}`, cards),
    h('p.hint', 'Secrets are write-only: once saved they are never shown again, on any screen.')));
}

const isOn = (spec, cfg) => (spec.group === 'google' ? getState().boot.google.connected : spec.group === 'ai' ? cfg.apiKeySet : spec.group === 'printer' ? cfg.mode !== 'browser' : spec.group === 'scanner' ? true : cfg.enabled);

function connectorCard(spec, cfg) {
  const form = h('form.conn-form', { onsubmit: (e) => e.preventDefault() });
  const inputs = {};
  for (const f of spec.fields) {
    let el;
    if (f.type === 'toggle') { el = h('input', { type: 'checkbox', checked: !!cfg[f.name] }); form.append(h('label.toggle', el, h('span.track'), h('span', f.label))); }
    else {
      if (f.type === 'select') el = h('select.input', f.options.map((o) => h('option', { value: o, selected: String(cfg[f.name]) === o }, o)));
      else if (f.type === 'image') el = imageInput(cfg[f.name]);
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
    const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.dataset.image !== undefined ? el.dataset.image : el.value]));
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
  const proofKey = { genericWebhook: 'qr' }[spec.group] || spec.group;
  return h('article.conn-card',
    h('header.conn-head', h('div.conn-icon', icon(spec.icon, 22)), h('div', h('h3', spec.title), h('p.muted', spec.desc), h('div', { 'data-proof': proofKey })), status),
    spec.steps ? h('details.conn-steps', { open: !isOn(spec, cfg) }, h('summary', 'How to set it up'), h('ol', spec.steps.map((x) => h('li', x)))) : null,
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
        ? h('div.row-actions', badge('Connected', 'ok'), h('button.btn.sm', { type: 'button', onclick: async () => { await post('/api/google/disconnect'); dispatch({ type: 'boot', boot: await get('/api/bootstrap') }); renderConnectors(document.querySelector('#view .page-body'), { sub: 'apps' }); } }, 'Disconnect'))
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

function printerExtra() {
  return h('div.row-actions',
    h('button.btn.sm', { type: 'button', onclick: async () => { try { await post('/api/print/test'); toast('Test page sent', 'success'); } catch (e) { errorToast(e); } } }, icon('printer', 14), 'Test print'),
    h('button.btn.sm', { type: 'button', onclick: async () => { try { await post('/api/print/drawer'); toast('Drawer opened', 'success'); } catch (e) { errorToast(e); } } }, icon('wallet', 14), 'Open drawer'));
}

function scannerExtra() {
  const out = h('code', '—');
  const area = h('input.input', { placeholder: 'Click here and scan something to test', 'aria-label': 'Scanner test' });
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter') { out.textContent = area.value || '—'; area.value = ''; } });
  return h('div.extra', area, h('small.muted', 'Last scan: ', out));
}
