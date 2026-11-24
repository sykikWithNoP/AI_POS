// Site map + hash router. Every screen has one address: #/<page>/<sub-page>[?params].
// Pages are the four sidebar items; sub-pages are the tabs under each page's header.
// Views never build their own tab bars: the shell draws them from this map, so every page behaves the same.

export const SITEMAP = [
  { id: 'pos', label: 'POS', title: 'Point of Sale', icon: 'cart', key: '1', subs: [
    { id: 'sell', label: 'Sell', icon: 'cart' },
    { id: 'items', label: 'Items', icon: 'box' },
    { id: 'customers', label: 'Customers', icon: 'user' },
  ] },
  { id: 'overview', label: 'Overview', title: 'Overview', icon: 'chart', key: '2', owner: true, subs: [
    { id: 'dashboard', label: 'Dashboard', icon: 'chart' },
    { id: 'bills', label: 'Bills', icon: 'receipt' },
    { id: 'reports', label: 'Reports', icon: 'download' },
    { id: 'ird', label: 'IRD', icon: 'shield' },
  ] },
  { id: 'connectors', label: 'Connectors', title: 'Connectors', icon: 'plug', key: '3', owner: true, subs: [
    { id: 'payments', label: 'Payments', icon: 'wallet' },
    { id: 'tax', label: 'Tax & IRD', icon: 'shield' },
    { id: 'apps', label: 'Apps & AI', icon: 'sparkles' },
    { id: 'devices', label: 'Devices', icon: 'printer' },
    { id: 'developer', label: 'Developer', icon: 'key' },
  ] },
  { id: 'settings', label: 'Settings', title: 'Settings', icon: 'gear', key: '4', owner: true, subs: [
    { id: 'business', label: 'Business', icon: 'receipt' },
    { id: 'appearance', label: 'Appearance', icon: 'sparkles' },
    { id: 'selling', label: 'Checkout', icon: 'wallet' },
    { id: 'memberships', label: 'Memberships', icon: 'user' },
    { id: 'security', label: 'Security', icon: 'lock' },
    { id: 'extensions', label: 'Extensions', icon: 'plug' },
    { id: 'data', label: 'Data', icon: 'upload' },
    { id: 'updates', label: 'Updates', icon: 'download' },
  ] },
];

export const pageById = (id) => SITEMAP.find((p) => p.id === id);
const lastSub = new Map();                 // page -> last visited sub-page (this tab only)

/** Read the current address. Unknown pages/sub-pages fall back to the first one. */
export function current() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [pid, sid] = path.split('/');
  const page = pageById(pid) || SITEMAP[0];
  const sub = page.subs.find((s) => s.id === sid) || null;
  return { page, sub, requested: sid || '', params: new URLSearchParams(query) };
}

/** Address of a page/sub-page. With no sub-page, the last one visited on that page (or its first). */
export function href(pageId, subId, params) {
  const page = pageById(pageId) || SITEMAP[0];
  const sub = subId || lastSub.get(page.id) || page.subs[0].id;
  const q = params ? `?${new URLSearchParams(params)}` : '';
  return `#/${page.id}/${sub}${q}`;
}

export const go = (pageId, subId, params) => { location.hash = href(pageId, subId, params); };
export const remember = (pageId, subId) => lastSub.set(pageId, subId);

/** Rewrite the address without adding a history entry (used to fill in a missing sub-page). */
export const replace = (to) => history.replaceState(null, '', to);
