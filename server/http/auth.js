// Access control for a POS that is used only on this computer.
//
//  1. Local only: every request must come from the loopback interface AND name a local host
//     (localhost / 127.0.0.1). A tunnel's public domain may reach only the public e-bill,
//     payment-return and webhook routes — never the dashboard or API.
//  2. Owner PIN: created on first run (no staff accounts). Selling needs no PIN; anything that
//     changes rules, money records or keys needs the PIN re-entered ("elevation", 10 min).
//  3. Wrong PINs lock out with growing delays; every attempt is written to the signed ledger.
//  4. Browser mutations need X-POS-Client + same-origin (CSRF); API keys are scoped and never elevated.
import { getGroup, setGroup } from '../services/settings.js';
import { authenticate } from '../services/apikeys.js';
import { HttpError, randomToken, verifyPin, hashPin, isLocked, rewrap } from '../lib.js';
import { LOCAL_HOSTNAMES } from '../config.js';
import { append as appendLedger } from '../security/ledger.js';
import { notify } from '../bus.js';
import { ownerExists, createOwner, verifyOwner, resetPassword, regenerateKey, validateCredentials as validateOwnerInput } from '../security/owner.js';

const sessions = new Map();   // token -> expiresAt (only used when lockScreen is on)
const elevations = new Map(); // token -> expiresAt
const ownerSessions = new Map(); // token -> { exp, idleMs }
const SESSION_MS = 12 * 3600_000;
const COOKIE = 'pos_session';
const ELEV = 'pos_elev';
const OWNER = 'pos_owner';

export const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const hostOf = (req) => String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
export const isLocalHost = (req) => LOCAL_HOSTNAMES.includes(hostOf(req));
export const pinSet = () => !!getGroup('security').pinHash;

const PUBLIC_PREFIXES = ['/b/', '/pay/', '/api/webhooks/', '/css/bill.css'];
export const isPublicPath = (p) => PUBLIC_PREFIXES.some((x) => p.startsWith(x));

/** First middleware: refuse anything that is not this computer talking to itself. */
export function localOnly(req, res, next) {
  if (!isLoopback(req)) { req.socket.destroy(); return; }
  if (isLocalHost(req)) return next();
  // A tunnel (cloudflared/ngrok running on this PC) arrives on loopback with a public Host header.
  const pub = getGroup('business').publicUrl;
  let pubHost = null;
  try { pubHost = pub ? new URL(pub).hostname.toLowerCase() : null; } catch { /* ignore */ }
  if (pubHost && hostOf(req) === pubHost && isPublicPath(req.path)) return next();
  res.status(421).type('text').send('This POS only runs on this computer.');
}

function cookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name);
  return m ? decodeURIComponent(m[1] || '') : null;
}
function valid(map, token) {
  const exp = token && map.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { map.delete(token); return false; }
  return true;
}
const setCookie = (res, name, value, maxAgeSec) => res.append('Set-Cookie', `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`);

// ---- PIN attempts: lockout with exponential back-off ----
const attempts = { fails: 0, lockedUntil: 0 };
function checkPin(pin, action) {
  if (Date.now() < attempts.lockedUntil) {
    const secs = Math.ceil((attempts.lockedUntil - Date.now()) / 1000);
    throw new HttpError(429, `Too many wrong PINs. Try again in ${secs}s.`, 'pin_locked');
  }
  if (verifyPin(String(pin ?? ''), getGroup('security').pinHash)) { attempts.fails = 0; return; }
  attempts.fails++;
  appendLedger('security.pin_failed', action, { fails: attempts.fails });
  if (attempts.fails >= 5) {
    const lockMs = Math.min(3600_000, 30_000 * 2 ** (attempts.fails - 5));
    attempts.lockedUntil = Date.now() + lockMs;
    notify({ type: 'security.lockout', level: 'error', title: 'PIN locked after repeated wrong attempts', body: `Locked for ${Math.round(lockMs / 1000)}s`, data: { fails: attempts.fails } });
  }
  throw new HttpError(401, 'Wrong PIN', 'bad_pin');
}
const ownerAttempts = { fails: 0, lockedUntil: 0 };
export const _resetAttempts = () => { attempts.fails = 0; attempts.lockedUntil = 0; ownerAttempts.fails = 0; ownerAttempts.lockedUntil = 0; };

function ownerGuardAttempt(ok, action) {
  if (ok) { ownerAttempts.fails = 0; return; }
  ownerAttempts.fails++;
  appendLedger('security.owner_failed', action, { fails: ownerAttempts.fails });
  if (ownerAttempts.fails >= 5) {
    const lockMs = Math.min(3600_000, 60_000 * 2 ** (ownerAttempts.fails - 5));
    ownerAttempts.lockedUntil = Date.now() + lockMs;
    notify({ type: 'security.lockout', level: 'error', title: 'Owner sign-in locked after repeated failures', body: `Locked for ${Math.round(lockMs / 1000)}s` });
  }
  throw new HttpError(401, 'Sign-in failed. Check the username, password and Owner Key.', 'owner_failed');
}
function ownerLocked() {
  if (Date.now() < ownerAttempts.lockedUntil) throw new HttpError(429, `Too many failed sign-ins. Try again in ${Math.ceil((ownerAttempts.lockedUntil - Date.now()) / 1000)}s.`, 'owner_locked');
}

function grantOwner(res) {
  const token = randomToken(32);
  const idleMs = Math.max(5, Math.min(240, Number(getGroup('security').ownerIdleMinutes) || 30)) * 60_000;
  ownerSessions.set(token, { exp: Date.now() + idleMs, idleMs });
  res.append('Set-Cookie', `${OWNER}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}`);
}
/** Owner session check with sliding idle timeout. */
export function isOwner(req) {
  const t = cookie(req, OWNER);
  const s = t && ownerSessions.get(t);
  if (!s) return false;
  if (s.exp < Date.now()) { ownerSessions.delete(t); return false; }
  s.exp = Date.now() + s.idleMs;
  return true;
}

export function ownerLogin(req, res, { username, password, key }) {
  ownerLocked();
  if (!ownerExists()) throw new HttpError(428, 'Create the owner account first', 'owner_setup_required');
  ownerGuardAttempt(verifyOwner(username, password, key), 'login');
  grantOwner(res); grantElevation(res);
  appendLedger('security.owner_signed_in', 'owner', {});
  return { ok: true };
}
export function ownerLogout(req, res) {
  ownerSessions.delete(cookie(req, OWNER));
  setCookie(res, OWNER, '', 0);
}
/** Existing install without an owner account: create one (needs the PIN). */
export function ownerSetup(req, res, { pin, username, password }) {
  if (ownerExists()) throw new HttpError(409, 'Owner account already exists', 'conflict');
  checkPin(pin, 'owner_setup');
  const key = createOwner(username, password);
  grantOwner(res); grantElevation(res);
  return { ok: true, ownerKey: key };
}
export function ownerResetPassword(req, res, { pin, key, password }) {
  ownerLocked();
  checkPin(pin, 'owner_reset');
  try { resetPassword(key, password); } catch (e) { if (e.code === 'bad_owner_key') ownerGuardAttempt(false, 'reset_password'); throw e; }
  return { ok: true };
}
export function ownerNewKey(req, res, { pin, password }) {
  ownerLocked();
  checkPin(pin, 'owner_new_key');
  try { return { ok: true, ownerKey: regenerateKey(password) }; } catch (e) { if (e.code === 'bad_password') ownerGuardAttempt(false, 'new_key'); throw e; }
}
export const clearOwnerSessions = () => ownerSessions.clear();

function grantElevation(res) {
  const token = randomToken(24);
  const mins = Math.max(1, Math.min(60, Number(getGroup('security').elevateMinutes) || 10));
  elevations.set(token, Date.now() + mins * 60_000);
  setCookie(res, ELEV, token, mins * 60);
}
function grantSession(res) {
  const token = randomToken(24);
  sessions.set(token, Date.now() + SESSION_MS);
  setCookie(res, COOKIE, token, SESSION_MS / 1000);
}

/** First run: create the owner PIN. Only possible while none exists. */
export function setup(req, res, { pin, username, password } = {}) {
  if (pinSet()) throw new HttpError(409, 'Owner PIN already set', 'conflict');
  if (!/^\d{4,8}$/.test(String(pin ?? ''))) throw new HttpError(400, 'PIN must be 4–8 digits', 'bad_request');
  if (username !== undefined) validateOwnerInput(username, password);
  setGroup('security', { pinHash: hashPin(pin) });
  appendLedger('security.pin_created', 'owner', {});
  grantSession(res); grantElevation(res);
  if (username !== undefined) { const key = createOwner(username, password); grantOwner(res); return { ok: true, ownerKey: key }; }
  return { ok: true };
}

export function login(req, res, pin) {
  checkPin(pin, 'login');
  grantSession(res);
  grantElevation(res);
  return { ok: true };
}

export function elevate(req, res, pin) {
  checkPin(pin, 'elevate');
  grantElevation(res);
  appendLedger('security.elevated', 'owner', {});
  return { ok: true, minutes: getGroup('security').elevateMinutes };
}

export function changePin(req, res, { current, pin }) {
  checkPin(current, 'change_pin');
  if (!/^\d{4,8}$/.test(String(pin ?? ''))) throw new HttpError(400, 'New PIN must be 4–8 digits (the PIN cannot be removed)', 'bad_request');
  setGroup('security', { pinHash: hashPin(pin) });
  rewrap('pin', pin); // keep the sealed key openable with the new PIN
  sessions.clear(); elevations.clear();
  appendLedger('security.pin_changed', 'owner', {});
  grantSession(res); grantElevation(res);
  return { ok: true };
}

export function logout(req, res) {
  sessions.delete(cookie(req, COOKIE)); elevations.delete(cookie(req, ELEV)); ownerSessions.delete(cookie(req, OWNER));
  setCookie(res, COOKIE, '', 0); setCookie(res, ELEV, '', 0); setCookie(res, OWNER, '', 0);
}
export const dropElevation = (req) => elevations.delete(cookie(req, ELEV));

export const isElevated = (req) => valid(elevations, cookie(req, ELEV)) || isOwner(req);

/** Who is calling: { kind: 'owner' } | { kind: 'apikey', scopes } | null. */
export function identify(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    const key = authenticate(h.slice(7).trim());
    if (!key) throw new HttpError(401, 'Invalid API key', 'bad_api_key');
    return { kind: 'apikey', scopes: key.scopes };
  }
  if (!isLocalHost(req)) return null;
  if (getGroup('security').lockScreen && !valid(sessions, cookie(req, COOKIE))) return null;
  return { kind: 'owner' };
}

export function authState(req) {
  if (isLocked()) return { sealed: true, local: isLoopback(req) && isLocalHost(req) };
  const sec = getGroup('security');
  let who = null;
  try { who = identify(req); } catch { /* ignore */ }
  return { setupRequired: !sec.pinHash, lockScreen: !!sec.lockScreen, authenticated: who?.kind === 'owner', elevated: isElevated(req), local: isLoopback(req) && isLocalHost(req),
    owner: { exists: !!sec.ownerUser, signedIn: isOwner(req) } };
}

function csrf(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-pos-client'] !== '1') throw new HttpError(403, 'Missing X-POS-Client header', 'csrf');
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let ok = false;
    try { ok = origin !== 'null' && new URL(origin).host === req.headers.host; } catch { ok = false; }
    if (!ok) throw new HttpError(403, 'Cross-origin request blocked', 'csrf');
  }
}

/** For unauthenticated endpoints (setup, login): still local-host + CSRF checked. */
export function csrfOnly(req, res, next) {
  if (!isLocalHost(req)) throw new HttpError(403, 'Local access only', 'forbidden');
  csrf(req);
  next();
}

/**
 * Route guard.
 *   requireAuth()                 owner only
 *   requireAuth({ scope: true })  owner, or an API key with read (GET) / write scope
 *   requireAuth({ elevated: true }) owner who re-entered the PIN recently (protected rules & records)
 *   requireAuth({ scope: true, elevatedOwner: true }) elevated owner, or a write-scoped API key
 *   requireAuth({ ownerArea: true }) owner signed in with username + password + Owner Key
 *   An owner session also satisfies PIN elevation.
 */
export function requireAuth({ scope, elevated, elevatedOwner, ownerArea } = {}) {
  return (req, res, next) => {
    if (!pinSet()) throw new HttpError(428, 'Create the owner PIN first', 'setup_required');
    const who = identify(req);
    if (!who) throw new HttpError(401, 'Locked — enter your PIN', 'unauthenticated');
    if (who.kind === 'apikey') {
      if (!scope || elevated) throw new HttpError(403, 'API keys cannot access this endpoint', 'forbidden');
      const need = req.method === 'GET' ? 'read' : 'write';
      if (!who.scopes.includes(need)) throw new HttpError(403, `API key lacks '${need}' scope`, 'forbidden');
    } else {
      csrf(req);
      if (ownerArea && !isOwner(req)) {
        if (!ownerExists()) throw new HttpError(403, 'Create the owner account to open this area', 'owner_setup_required');
        throw new HttpError(403, 'Owner sign-in required', 'owner_required');
      }
      if ((elevated || elevatedOwner) && !isElevated(req)) throw new HttpError(403, 'Owner PIN required for this action', 'pin_required');
    }
    req.who = who;
    req.elevated = who.kind === 'owner' && isElevated(req);
    next();
  };
}
