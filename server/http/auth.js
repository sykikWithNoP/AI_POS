// Localhost-first access control.
//  - Requests from this PC are trusted when no PIN is set (personal POS).
//  - Set a PIN to lock the dashboard (sessions) — required before exposing the POS on a LAN.
//  - External apps use API keys (Bearer pos_...) with read/write scopes.
//  - Browser mutations must carry X-POS-Client and a same-origin Origin (CSRF guard), and the Host
//    header must be a known name (DNS-rebinding guard).
import { getGroup } from '../services/settings.js';
import { authenticate } from '../services/apikeys.js';
import { HttpError, randomToken, verifyPin } from '../lib.js';

const sessions = new Map(); // token -> expiresAt
const SESSION_MS = 12 * 3600_000;
const COOKIE = 'pos_session';

export const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
export const pinEnabled = () => !!getGroup('security').pinHash;

function cookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name);
  return m ? decodeURIComponent(m[1] || '') : null;
}

function hasSession(req) {
  const t = cookie(req, COOKIE);
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

export function login(req, res, pin) {
  if (!pinEnabled()) return { ok: true };
  if (!verifyPin(pin, getGroup('security').pinHash)) throw new HttpError(401, 'Wrong PIN', 'bad_pin');
  const token = randomToken(24);
  sessions.set(token, Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
  return { ok: true };
}

export function logout(req, res) {
  const t = cookie(req, COOKIE);
  if (t) sessions.delete(t);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export const clearSessions = () => sessions.clear();

/** Who is calling: 'owner' (dashboard) | 'apikey' | null. */
export function identify(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    const key = authenticate(h.slice(7).trim());
    if (!key) throw new HttpError(401, 'Invalid API key', 'bad_api_key');
    return { kind: 'apikey', scopes: key.scopes };
  }
  if (pinEnabled() ? hasSession(req) : isLoopback(req)) return { kind: 'owner' };
  return null;
}

export function authState(req) {
  return { pinEnabled: pinEnabled(), authenticated: !!safeIdentify(req), local: isLoopback(req) };
}
function safeIdentify(req) { try { return identify(req)?.kind === 'owner'; } catch { return false; } }

/** Host header allowlist (blocks DNS rebinding against a localhost server). */
export function hostGuard(allowedHosts) {
  return (req, res, next) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
    const extra = [];
    const pub = getGroup('business').publicUrl;
    if (pub) { try { extra.push(new URL(pub).hostname.toLowerCase()); } catch { /* ignore */ } }
    if (allowedHosts === '*' || allowedHosts.includes(host) || extra.includes(host)) return next();
    res.status(421).send('Unknown host');
  };
}

/** Require owner (dashboard) access, or an API key with the right scope when `scope` is given. */
export function requireAuth({ scope } = {}) {
  return (req, res, next) => {
    const who = identify(req);
    if (!who) throw new HttpError(401, pinEnabled() ? 'Locked — enter your PIN' : 'Remote access needs a PIN to be set first', 'unauthenticated');
    if (who.kind === 'apikey') {
      if (!scope) throw new HttpError(403, 'API keys cannot access this endpoint', 'forbidden');
      const need = req.method === 'GET' ? 'read' : 'write';
      if (!who.scopes.includes(need)) throw new HttpError(403, `API key lacks '${need}' scope`, 'forbidden');
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      // CSRF guard for cookie/loopback auth: custom header + same-origin.
      if (req.headers['x-pos-client'] !== '1') throw new HttpError(403, 'Missing X-POS-Client header', 'csrf');
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked', 'csrf');
    }
    req.who = who;
    next();
  };
}
