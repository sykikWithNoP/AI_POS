// Phone edition only (NINDITO POS Mobile): the updates card and phone-style backups.
// Loaded by app.js only when running inside the mobile app.
import { h, icon, toast, errorToast } from './ui.js';
import { get, post } from './api.js';

export const isMobile = () => !!globalThis.__POS_MOBILE__;

/** Settings › Updates on the phone. Automatic updates are not switched on yet. */
export function mobileUpdatesCard() {
  return h('section.card',
    h('header.card-head', h('h3', icon('download', 18), 'App updates')),
    h('div.meta-grid', h('div', h('small', 'Installed version'), h('b', globalThis.__POS_MOBILE__?.version || '—'))),
    h('p', 'To update, open a newer NINDITO POS .apk on this phone and tap Install. It installs over this one: your sales, products and settings stay.'),
    h('p.hint', 'Save a backup first (Settings › Data) — just in case. Automatic updates will come in a later version.'));
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
