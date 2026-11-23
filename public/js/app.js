// App shell: auth gate, four-item navigation, router, notifications bell, copilot.
import { h, icon, errorToast, fmtDate, toast } from './ui.js';
import { get, post } from './api.js';
import { dispatch, getState, subscribe } from './store.js';
import { connectLive } from './live.js';
import { loadExtensions, emitExt } from './extensions.js';
import { applyTheme } from './theme.js';
import { toggleCopilot } from './copilot.js';
import { renderPos, loadItems } from './views/pos.js';
import { renderOverview } from './views/overview.js';
import { renderConnectors } from './views/connectors.js';
import { renderSettings } from './views/settings.js';

const NAV = [
  { id: 'pos', label: 'POS', icon: 'cart', render: renderPos, key: '1' },
  { id: 'overview', label: 'Overview', icon: 'chart', render: renderOverview, key: '2' },
  { id: 'connectors', label: 'Connectors', icon: 'plug', render: renderConnectors, key: '3' },
  { id: 'settings', label: 'Settings', icon: 'gear', render: renderSettings, key: '4' },
];

let cleanup = null;
const app = document.getElementById('app');

async function start() {
  try { applyTheme(localStorage.getItem('pos.theme') || 'system'); } catch { /* ignore */ }
  const auth = await get('/api/auth/state');
  if (!auth.authenticated) return renderLogin(auth);
  const boot = await get('/api/bootstrap');
  dispatch({ type: 'boot', boot });
  applyTheme(boot.settings.ui.theme);
  loadExtensions(boot.extensions);
  await loadItems();
  dispatch({ type: 'notifications', list: await get('/api/notifications') });
  renderShell();
  connectLive();
  window.addEventListener('hashchange', route);
  route();
}

function renderLogin(auth) {
  const pin = h('input.input.pin', { type: 'password', inputMode: 'numeric', autocomplete: 'current-password', placeholder: '••••', 'aria-label': 'PIN' });
  const submit = async () => {
    try { await post('/api/auth/login', { pin: pin.value }); location.reload(); }
    catch (e) { errorToast(e); pin.value = ''; pin.focus(); }
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  app.replaceChildren(h('main.login',
    h('div.login-card', h('div.brand-mark', icon('cart', 28)), h('h1', 'Unlock POS'),
      auth.pinEnabled ? [pin, h('button.btn.primary.block', { onclick: submit }, icon('lock', 16), 'Unlock')]
        : h('p', 'This POS accepts connections only from its own computer until a PIN is set. Open it on the host PC (http://localhost) and set a PIN in Settings → Security.'))));
  setTimeout(() => pin.focus(), 50);
}

function renderShell() {
  const biz = getState().boot.settings.business;
  const bellCount = h('span.bell-count');
  const clock = h('span.clock');
  const tick = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 15000);

  const nav = h('nav.sidenav', { 'aria-label': 'Main' },
    h('div.brand', h('div.brand-mark', icon('cart', 20)), h('span.brand-name', biz.name)),
    h('ul', NAV.map((n) => h('li', h('a.nav-link', { href: `#/${n.id}`, 'data-id': n.id, title: `${n.label} (Alt+${n.key})` }, icon(n.icon, 22), h('span', n.label))))),
    h('div.nav-foot', h('button.nav-link', { onclick: toggleCopilot, title: 'AI copilot' }, icon('sparkles', 22), h('span', 'Copilot'))));

  const top = h('header.topbar',
    h('h1.view-title'),
    h('div.top-actions',
      clock,
      h('button.icon-btn.bell', { 'aria-label': 'Notifications', onclick: bellPanel }, icon('bell', 20), bellCount),
      h('button.icon-btn', { 'aria-label': 'AI copilot', title: 'AI copilot', onclick: toggleCopilot }, icon('sparkles', 20)),
      getState().boot.settings.security.pinHashSet ? h('button.icon-btn', { 'aria-label': 'Lock', title: 'Lock', onclick: async () => { await post('/api/auth/logout'); location.reload(); } }, icon('lock', 20)) : null));

  app.replaceChildren(h('div.shell', nav, h('div.main', top, h('main#view'))));
  const drawBell = () => {
    const n = getState().notifications.filter((x) => !x.read).length;
    bellCount.textContent = n ? (n > 9 ? '9+' : n) : '';
    bellCount.hidden = !n;
  };
  drawBell();
  subscribe((s, prev) => {
    if (s.notifications !== prev.notifications) drawBell();
    if (s.boot !== prev.boot) document.querySelector('.brand-name').textContent = s.boot.settings.business.name;
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); location.hash = `#/${NAV[Number(e.key) - 1].id}`; }
  });
}

function bellPanel() {
  document.querySelector('.bell-panel')?.remove();
  const list = getState().notifications;
  const panel = h('div.bell-panel', { role: 'dialog', 'aria-label': 'Notifications' },
    h('header', h('b', 'Notifications'), h('button.btn.sm', { onclick: async () => {
      await post('/api/notifications/read');
      dispatch({ type: 'notifications', list: list.map((n) => ({ ...n, read: true })) });
      panel.remove();
    } }, 'Mark all read')),
    h('ul', list.length ? list.slice(0, 30).map((n) => h(`li.${n.level}${n.read ? '.read' : ''}`, h('b', n.title), n.body ? h('span', n.body) : null, h('time', fmtDate(n.created_at)))) : h('li.muted', 'Nothing yet')));
  document.body.append(panel);
  const away = (e) => { if (!panel.contains(e.target) && !e.target.closest('.bell')) { panel.remove(); document.removeEventListener('mousedown', away); } };
  setTimeout(() => document.addEventListener('mousedown', away), 0);
}

function route() {
  const id = (location.hash.match(/^#\/([a-z]+)/) || [])[1] || 'pos';
  const nav = NAV.find((n) => n.id === id) || NAV[0];
  for (const a of document.querySelectorAll('.nav-link[data-id]')) a.classList.toggle('active', a.dataset.id === nav.id);
  document.querySelector('.view-title').textContent = { pos: 'Point of Sale', overview: 'Overview', connectors: 'Connectors', settings: 'Settings' }[nav.id];
  cleanup?.();
  const view = document.getElementById('view');
  view.className = `view-${nav.id}`;
  try { cleanup = nav.render(view) || null; } catch (e) { errorToast(e); }
  emitExt('view:change', nav.id);
}

window.addEventListener('pos:locked', () => { toast('Session locked', 'warn'); setTimeout(() => location.reload(), 800); });
start().catch((e) => { app.replaceChildren(h('main.login', h('div.login-card', h('h1', 'Could not start'), h('p', e.message)))); });
