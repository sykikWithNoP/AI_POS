// Phone edition only (NINDITO POS Mobile): app updates from GitHub Releases and phone-style backups.
// Loaded by app.js only when running inside the mobile app.
import { h, icon, toast, errorToast } from './ui.js';
import { get, post } from './api.js';

export const isMobile = () => !!globalThis.__POS_MOBILE__;
const platform = () => globalThis.__POS_MOBILE__?.platform || 'web';

function openUpdate(u) {
  const url = platform() === 'android' ? u.apk || u.page : u.page;
  window.open(url, '_blank');
}

/** Banner after start-up when a newer app version is on GitHub (owner signed in). */
export async function updateBanner() {
  try {
    const u = await get('/api/mobile/update');
    if (!u.available || sessionStorage.getItem('pos.update.later') === u.latest) return;
    document.querySelector('.m-update')?.remove();
    const bar = h('div.m-update', { role: 'status' }, icon('download', 18),
      h('span', h('b', `NINDITO POS ${u.latest} is available`), h('br'), h('small', `You have ${u.current}.`)),
      h('button.ghost', { type: 'button', onclick: () => { sessionStorage.setItem('pos.update.later', u.latest); bar.remove(); } }, 'Later'),
      h('button', { type: 'button', onclick: () => openUpdate(u) }, 'Update'));
    document.body.append(bar);
  } catch { /* offline or not signed in: try next time */ }
}

/** Settings › Updates on the phone. */
export function mobileUpdatesCard() {
  const box = h('div', h('p.muted', 'Checking…'));
  const load = async (force) => {
    try {
      const u = await get(`/api/mobile/update${force ? '?force=1' : ''}`);
      box.replaceChildren(
        h('div.meta-grid', h('div', h('small', 'Installed'), h('b', u.current)), h('div', h('small', 'Latest on GitHub'), h('b', u.latest))),
        u.available
          ? h('div.integrity.ok', icon('download', 18), h('div', h('b', `Version ${u.latest} is ready. `), u.notes ? h('p', u.notes) : null,
            h('button.btn.sm.primary', { onclick: () => openUpdate(u) }, platform() === 'ios' ? 'Open the release page' : 'Download & install')))
          : h('p', icon('check', 16), ' You have the latest version.'),
        platform() === 'android' ? h('p.hint', 'Android will ask once to allow installing from your browser. Your sales and settings stay on the phone; the update only replaces the app.') : null,
        platform() === 'ios' ? h('p.hint', 'iPhone apps from outside the App Store are installed with a sideloading tool (see the release page). Your data stays on the phone.') : null,
        h('p.hint', `Updates come from github.com/${u.page.split('/')[3]}/${u.page.split('/')[4]} releases. Only versions signed with the same key as this app can be installed over it.`));
    } catch (e) { box.replaceChildren(h('p.danger-text', e.message), h('p.hint', 'Check the internet connection, or turn off Offline mode in Settings › Security.')); }
  };
  load(false);
  return h('section.card',
    h('header.card-head', h('h3', icon('download', 18), 'App updates'), h('button.btn.sm', { onclick: () => load(true) }, icon('refresh', 14), 'Check now')),
    box);
}

/** Settings › Data on the phone: save a backup to Google Drive, Files, email… through the share sheet. */
export function phoneBackupBox() {
  const age = h('p.hint');
  const refresh = async () => {
    const r = (await get('/api/backups')).reminder;
    age.replaceChildren(r.days === null ? 'No backup has been saved off this phone yet.' : `Last backup saved off this phone: ${r.days === 0 ? 'today' : `${r.days} day${r.days === 1 ? '' : 's'} ago`}.`, r.due ? h('b.warn-text', ' Time for a new one.') : '');
  };
  refresh().catch(() => {});
  return h('div.usb-box',
    h('p.hint', 'If this phone is lost or broken, a saved backup is how you get everything back. Save one to Google Drive, Files, or email it to yourself once a week. Saved connector keys are not included (for safety).'),
    age,
    h('button.btn.primary', { type: 'button', onclick: async () => {
      try {
        const b = await post('/api/backups');
        const a = h('a', { href: `/api/backups/${encodeURIComponent(b.name)}` });
        document.body.append(a); a.click(); a.remove();
        await post('/api/mobile/backup-saved');
        toast('Choose where to keep the backup', 'info'); refresh();
      } catch (e) { errorToast(e); }
    } }, icon('download', 16), 'Save a backup off this phone'));
}
