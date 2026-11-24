// Phone-only routes (/api/mobile/*), mounted in front of the POS routes.
// No update source yet: a newer app is installed by opening a newer .apk over this one (data stays).
import { Router } from './shims/express.js';

export function mobileRouter(requireAuth) {
  const r = Router();
  const owner = requireAuth({ ownerArea: true });
  r.get('/info', requireAuth(), (req, res) => res.json({ version: globalThis.__POS_MOBILE_VERSION__, platform: globalThis.__POS_MOBILE__?.platform }));
  // Remembers when a backup was saved off the phone (for the weekly reminder).
  r.post('/backup-saved', owner, async (req, res) => {
    const { setGroup } = await import('../../server/services/settings.js');
    setGroup('backup', { lastExternalAt: new Date().toISOString() });
    res.json({ ok: true });
  });
  return r;
}
