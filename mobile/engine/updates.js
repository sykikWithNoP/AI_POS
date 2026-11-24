// App updates from GitHub Releases. Each phone release is published by the GitHub workflow with a tag
// like "mobile-v1.2.0" and the Android .apk (and iPhone .ipa) attached. The app asks GitHub — through the
// same privacy gate as every other outbound call, so "offline mode" stops it — at most once every few
// hours, and shows a banner when a newer version exists. Android only installs an update that is signed
// with the same key as the installed app, so nobody else can push an update to your phone.
import { Router } from './shims/express.js';

export const REPO = 'sykikWithNoP/AI_POS';
const TAG = /^mobile-v(\d+\.\d+\.\d+)$/;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
let last = null;

export async function checkGithub({ force = false } = {}) {
  if (!force && last && Date.now() - last.at < 3 * 3600_000) return last;
  const { egressFetch } = await import('../../server/security/egress.js');
  const res = await egressFetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, { headers: { accept: 'application/vnd.github+json' } }, { purpose: 'app-update-check', extraHosts: ['api.github.com'] });
  if (!res.ok) throw Object.assign(new Error(`GitHub answered ${res.status}`), { status: 502 });
  const list = await res.json();
  const current = globalThis.__POS_MOBILE_VERSION__ || '0.0.0';
  const rel = list.filter((r) => !r.draft && !r.prerelease && TAG.test(r.tag_name)).sort((a, b) => cmp(TAG.exec(b.tag_name)[1], TAG.exec(a.tag_name)[1]))[0];
  const latest = rel ? TAG.exec(rel.tag_name)[1] : current;
  const asset = (ext) => rel?.assets?.find((a) => a.name.toLowerCase().endsWith(ext))?.browser_download_url || null;
  last = {
    at: Date.now(), current, latest, available: !!rel && cmp(latest, current) > 0,
    notes: String(rel?.body || '').slice(0, 1500), page: rel?.html_url || `https://github.com/${REPO}/releases`,
    apk: asset('.apk'), ipa: asset('.ipa'),
  };
  return last;
}

/** /api/mobile/* routes, mounted in front of the POS routes. Owner sign-in is required. */
export function mobileRouter(requireAuth) {
  const r = Router();
  const owner = requireAuth({ ownerArea: true });
  r.get('/info', requireAuth(), (req, res) => res.json({ version: globalThis.__POS_MOBILE_VERSION__, platform: globalThis.__POS_MOBILE__?.platform, repo: REPO }));
  r.post('/backup-saved', owner, async (req, res) => {
    const { setGroup } = await import('../../server/services/settings.js');
    setGroup('backup', { lastExternalAt: new Date().toISOString() });
    res.json({ ok: true });
  });
  r.get('/update', owner, async (req, res, next) => { try { res.json(await checkGithub({ force: req.query.force === '1' })); } catch (e) { next(e); } });
  return r;
}
