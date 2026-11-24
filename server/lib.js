// Small shared helpers: errors, ids, hashing, at-rest encryption for BYOK secrets.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}
export const badRequest = (msg) => new HttpError(400, msg, 'bad_request');
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'not_found');
export const conflict = (msg) => new HttpError(409, msg, 'conflict');

export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// --- PIN hashing (scrypt) ---
export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPin(pin, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const got = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return safeEqual(got, hash);
}

// --- Master key: encrypts provider secrets (AES-256-GCM) and keys the signed ledger ---
// Stored either as data/secret.key (default) or SEALED in data/secret.key.sealed, wrapped twice:
// with a key derived from the till PIN and with one derived from the Owner Key (recovery).
// While sealed and not yet unlocked after a start, nothing that needs the key can run.
let masterKey;
const keyFile = () => path.join(config.dataDir, 'secret.key');
const sealedFile = () => path.join(config.dataDir, 'secret.key.sealed');
const SEAL_SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const unlockTries = { fails: 0, until: 0 };

export const isSealed = () => !process.env.POS_SECRET_KEY && fs.existsSync(sealedFile());
export const isLocked = () => !masterKey && isSealed();

function key() {
  if (masterKey) return masterKey;
  if (process.env.POS_SECRET_KEY) {
    masterKey = crypto.createHash('sha256').update(process.env.POS_SECRET_KEY).digest();
    return masterKey;
  }
  if (isSealed()) throw new HttpError(423, 'The POS is locked — enter the PIN to start it', 'sealed');
  const file = keyFile();
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  masterKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  return masterKey;
}

const normSecret = (kind, v) => (kind === 'owner' ? String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^OK/, '') : String(v || ''));
function wrap(kind, secret, mk) {
  const salt = crypto.randomBytes(16);
  const k = crypto.scryptSync(normSecret(kind, secret), salt, 32, SEAL_SCRYPT);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(mk), c.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function unwrap(kind, secret, w) {
  const k = crypto.scryptSync(normSecret(kind, secret), Buffer.from(w.salt, 'base64'), 32, SEAL_SCRYPT);
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(w.iv, 'base64'));
  d.setAuthTag(Buffer.from(w.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(w.ct, 'base64')), d.final()]);
}
const readSealed = () => JSON.parse(fs.readFileSync(sealedFile(), 'utf8'));
function writeSealed(obj) {
  const tmp = sealedFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, sealedFile());
}
function shred(file) {
  if (!fs.existsSync(file)) return;
  try { fs.writeFileSync(file, crypto.randomBytes(fs.statSync(file).size || 64)); } catch { /* best effort */ }
  fs.rmSync(file, { force: true });
}

/** Unlock after a start with the PIN, or the Owner Key as recovery. */
export function unseal(secret, kind = 'pin') {
  if (!isSealed()) return true;
  if (masterKey) return true;
  if (Date.now() < unlockTries.until) throw new HttpError(429, `Too many wrong attempts. Try again in ${Math.ceil((unlockTries.until - Date.now()) / 1000)}s.`, 'locked_out');
  const s = readSealed();
  const w = s.wraps?.[kind];
  if (!w) throw new HttpError(400, kind === 'owner' ? 'No Owner Key recovery was set up' : 'Unknown unlock method', 'bad_request');
  try { masterKey = unwrap(kind, secret, w); unlockTries.fails = 0; return true; }
  catch {
    unlockTries.fails++;
    if (unlockTries.fails >= 5) unlockTries.until = Date.now() + Math.min(3600_000, 30_000 * 2 ** (unlockTries.fails - 5));
    throw new HttpError(401, kind === 'owner' ? 'Owner Key is not correct' : 'Wrong PIN', 'bad_unlock');
  }
}

/** Seal the master key with the PIN (+ Owner Key for recovery) and remove the plain key file. */
export function seal({ pin, ownerKey }) {
  if (process.env.POS_SECRET_KEY) throw new HttpError(409, 'The key comes from POS_SECRET_KEY; sealing is not available', 'conflict');
  const mk = key();
  writeSealed({ v: 1, createdAt: new Date().toISOString(), wraps: { pin: wrap('pin', pin, mk), ...(ownerKey ? { owner: wrap('owner', ownerKey, mk) } : {}) } });
  shred(keyFile());
}

/** Re-wrap one of the two locks (after a PIN or Owner Key change). */
export function rewrap(kind, secret) {
  if (!isSealed() || !masterKey) return;
  const s = readSealed();
  s.wraps[kind] = wrap(kind, secret, masterKey);
  writeSealed(s);
}

/** Go back to a plain key file (no PIN at startup). */
export function unsealPermanently() {
  if (!isSealed()) return;
  const mk = key();
  fs.writeFileSync(keyFile(), mk.toString('hex'), { mode: 0o600 });
  fs.rmSync(sealedFile(), { force: true });
}
export const sealInfo = () => (isSealed() ? { sealed: true, ownerRecovery: !!readSealed().wraps?.owner, locked: !masterKey } : { sealed: false });
export const _forgetKeyForTests = () => { masterKey = undefined; unlockTries.fails = 0; unlockTries.until = 0; };

/** Purpose-bound sub-key (e.g. 'ledger') derived from the master key. */
export function deriveKey(label) {
  // Internal derivation label from the first release. Never change it: saved keys and the signed ledger depend on it.
  return crypto.createHmac('sha256', key()).update(`free-ai-pos:${label}`).digest();
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
export function decrypt(blob) {
  if (typeof blob !== 'string' || !blob.startsWith('enc:v1:')) return blob;
  const [, , iv, tag, data] = blob.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

/**
 * Outbound HTTP through the egress gate (allowlist, key pinning, no fingerprinting).
 * Returns { ok, status, json, text }; never throws on HTTP status.
 */
export async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 15000, purpose } = {}) {
  const { egressFetch } = await import('./security/egress.js');
  const res = await egressFetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) }, { purpose: purpose || new URL(url).hostname });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

export const log = {
  info: (msg, extra = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg, ...extra })),
  warn: (msg, extra = {}) => console.warn(JSON.stringify({ t: new Date().toISOString(), level: 'warn', msg, ...extra })),
  error: (msg, extra = {}) => console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg, ...extra })),
};
