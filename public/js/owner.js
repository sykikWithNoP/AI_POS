// Owner areas (Overview, Settings, Connectors): sign in with username + password + Owner Key.
import { h, icon, toast, errorToast, modal, field } from './ui.js';
import { get, post } from './api.js';
import { getState, dispatch } from './store.js';
import { SITEMAP } from './router.js';

export const OWNER_AREAS = SITEMAP.filter((p) => p.owner).map((p) => p.id);

export async function refreshBoot() {
  dispatch({ type: 'boot', boot: await get('/api/bootstrap') });
}

/** Read an Owner Key typed in, or from a chosen key file. */
function keyField() {
  const input = h('input.input.mono', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'OK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX', 'aria-label': 'Owner Key' });
  const file = h('input', { type: 'file', accept: '.txt,.poskey,text/plain', 'aria-label': 'Owner Key file' });
  file.addEventListener('change', async () => {
    const t = await file.files[0]?.text();
    const m = /OK[-\s]?([A-Z2-9]{5}[-\s]?){6}/i.exec(t || '');
    if (m) { input.value = m[0]; toast('Owner Key loaded from file', 'success'); } else toast('No Owner Key found in that file', 'warn');
  });
  return { input, el: h('div.key-field', input, h('label.btn.sm', icon('upload', 14), 'Key file', file)) };
}

/** Full-page gate shown inside an owner area until the owner signs in. */
export function renderOwnerGate(view, onDone) {
  const exists = getState().boot.settings.security.ownerExists ?? true;
  if (!exists) return renderOwnerSetup(view, onDone);
  const user = h('input.input', { autocomplete: 'username', placeholder: 'Username' });
  const pass = h('input.input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const key = keyField();
  const submit = async () => {
    try { await post('/api/auth/owner/login', { username: user.value, password: pass.value, key: key.input.value }); pass.value = ''; key.input.value = ''; await refreshBoot(); onDone(); }
    catch (e) { errorToast(e); pass.value = ''; pass.focus(); }
  };
  for (const el of [user, pass, key.input]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  view.replaceChildren(h('div.owner-gate', h('div.login-card',
    h('div.brand-mark', icon('shield', 26)), h('h2', 'Owner sign-in'),
    h('p.muted', 'Overview, Settings and Connectors are for the owner. Enter your username, password and Owner Key.'),
    h('div.form-grid', field('Username', user), field('Password', pass), field('Owner Key', key.el)),
    h('button.btn.primary.block', { onclick: submit }, icon('lock', 16), 'Sign in'),
    h('button.btn.ghost.sm', { onclick: () => recoverDialog() }, 'Forgot password?'))));
  setTimeout(() => user.focus(), 30);
}

function renderOwnerSetup(view, onDone) {
  const user = h('input.input', { autocomplete: 'username', placeholder: 'e.g. owner' });
  const pass = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 10 characters' });
  const again = h('input.input', { type: 'password', autocomplete: 'new-password' });
  const pin = h('input.input', { type: 'password', inputMode: 'numeric', autocomplete: 'off', placeholder: 'Your PIN' });
  view.replaceChildren(h('div.owner-gate', h('div.login-card',
    h('div.brand-mark', icon('shield', 26)), h('h2', 'Create the owner account'),
    h('p.muted', 'Choose a username and password. The POS then gives you an Owner Key — you need all three to open Overview, Settings and Connectors.'),
    h('div.form-grid', field('Username', user), field('Password', pass), field('Repeat password', again), field('Current PIN', pin)),
    h('button.btn.primary.block', { onclick: async () => {
      if (pass.value !== again.value) return toast('Passwords do not match', 'warn');
      try {
        const r = await post('/api/auth/owner/setup', { username: user.value, password: pass.value, pin: pin.value }, { noPinRetry: true });
        await showOwnerKey(r.ownerKey, user.value);
        await refreshBoot(); onDone();
      } catch (e) { errorToast(e); }
    } }, 'Create owner account'))));
}

/** Show a freshly generated Owner Key once; the owner must save it and confirm. */
export function showOwnerKey(key, username = '') {
  return new Promise((resolve) => {
    const confirm = h('input.input.mono', { placeholder: 'Type the last 5 characters', maxLength: 5, autocomplete: 'off' });
    const download = () => {
      const blob = new Blob([`NINDITO POS — Owner Key\nUsername: ${username}\nCreated: ${new Date().toLocaleString()}\n\n${key}\n\nKeep this file offline (USB stick or printed). Anyone with it AND your password can open the owner areas.\n`], { type: 'text/plain' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'nindito-pos-owner-key.txt' });
      document.body.append(a); a.click(); a.remove();
    };
    let done = false;
    const m = modal({
      title: 'Your Owner Key — save it now', wide: true,
      onClose: () => { if (!done) setTimeout(() => showOwnerKey(key, username).then(resolve), 0); },
      body: h('div.form-grid',
        h('p', 'This key is shown only once. You need it with your username and password to open the owner areas, and to reset a forgotten password.'),
        h('pre.code.select.owner-key', key),
        h('div.row-actions',
          h('button.btn', { onclick: () => { navigator.clipboard?.writeText(key); toast('Copied', 'success'); } }, icon('link', 14), 'Copy'),
          h('button.btn', { onclick: download }, icon('download', 14), 'Download key file'),
          h('button.btn', { onclick: () => window.print() }, icon('printer', 14), 'Print')),
        field('To confirm you saved it', confirm)),
      actions: [{ label: 'I have saved it', primary: true, onClick: (c) => {
        if (confirm.value.trim().toUpperCase() !== key.slice(-5)) return toast('That does not match the end of the key', 'warn');
        done = true; c(); resolve();
      } }],
    });
    return m;
  });
}

function recoverDialog() {
  const pin = h('input.input', { type: 'password', inputMode: 'numeric', placeholder: 'PIN' });
  const key = keyField();
  const pass = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'New password (10+ characters)' });
  modal({
    title: 'Reset owner password',
    body: h('div.form-grid', h('p.hint', 'Needs your Owner Key and PIN. Lost the Owner Key too? Run "npm run reset-owner" (or "node server.mjs --reset-owner") on this PC, then create a new owner account.'),
      field('Owner Key', key.el), field('PIN', pin), field('New password', pass)),
    actions: [{ label: 'Reset password', primary: true, onClick: async (c) => {
      try { await post('/api/auth/owner/reset-password', { key: key.input.value, pin: pin.value, password: pass.value }, { noPinRetry: true }); toast('Password changed. Sign in with the new password.', 'success'); c(); }
      catch (e) { errorToast(e); }
    } }],
  });
}

export async function ownerSignOut() {
  await post('/api/auth/owner/logout');
  await refreshBoot();
  location.hash = '#/pos';
  toast('Signed out of the owner area', 'info');
}
