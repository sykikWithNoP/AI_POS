// Owner account: username + password + Owner Key (generated once, 150 bits). All three are needed to
// open the owner areas (Overview, Settings, Connectors, reports, AI, keys, backups, updates).
// Password and key are stored only as scrypt hashes (inside the encrypted settings).
import crypto from 'node:crypto';
import { getGroup, setGroup } from '../services/settings.js';
import { HttpError, safeEqual, rewrap } from '../lib.js';
import { append as appendLedger } from './ledger.js';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function hashSecret(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `s2:${salt}:${crypto.scryptSync(String(value), salt, 32, SCRYPT).toString('hex')}`;
}
export function checkSecret(value, stored) {
  if (!stored || !stored.startsWith('s2:')) { crypto.scryptSync('x', 'pad', 32, SCRYPT); return false; } // same cost either way
  const [, salt, hash] = stored.split(':');
  return safeEqual(crypto.scryptSync(String(value ?? ''), salt, 32, SCRYPT).toString('hex'), hash);
}

/** Owner Key: 30 chars from a 32-symbol alphabet (150 bits), shown as OK-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateOwnerKey() {
  const bytes = crypto.randomBytes(30);
  const chars = [...bytes].map((b) => B32[b & 31]).join('');
  return `OK-${chars.match(/.{5}/g).join('-')}`;
}
export const normalizeKey = (k) => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^OK/, '');

export function validateCredentials(username, password) {
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) throw new HttpError(400, 'Username: 3–32 letters, numbers, dot, dash or underscore', 'bad_request');
  const p = String(password || '');
  if (p.length < 10) throw new HttpError(400, 'Password must be at least 10 characters', 'bad_request');
  if (p.toLowerCase().includes(u)) throw new HttpError(400, 'Password must not contain the username', 'bad_request');
  if (new Set(p).size < 5) throw new HttpError(400, 'Password is too simple', 'bad_request');
  return { u, p };
}

export const ownerExists = () => !!getGroup('security').ownerUser;

/** Create (or re-create during recovery) the owner account. Returns the Owner Key — shown once. */
export function createOwner(username, password) {
  const { u, p } = validateCredentials(username, password);
  const key = generateOwnerKey();
  setGroup('security', { ownerUser: u, ownerPassHash: hashSecret(p), ownerKeyHash: hashSecret(normalizeKey(key)) });
  rewrap('owner', key);
  appendLedger('security.owner_created', u, {});
  return key;
}

/** Verify all three; never reveals which part was wrong. */
export function verifyOwner(username, password, key) {
  const sec = getGroup('security');
  const userOk = safeEqual(String(username || '').trim().toLowerCase(), sec.ownerUser || '\u0000');
  const passOk = checkSecret(password, sec.ownerPassHash);
  const keyOk = checkSecret(normalizeKey(key), sec.ownerKeyHash);
  return userOk && passOk && keyOk;
}

export function resetPassword(key, newPassword) {
  const sec = getGroup('security');
  if (!checkSecret(normalizeKey(key), sec.ownerKeyHash)) throw new HttpError(401, 'Owner Key is not correct', 'bad_owner_key');
  const { p } = validateCredentials(sec.ownerUser, newPassword);
  setGroup('security', { ownerPassHash: hashSecret(p) });
  appendLedger('security.owner_password_reset', sec.ownerUser, {});
}

export function regenerateKey(password) {
  const sec = getGroup('security');
  if (!checkSecret(password, sec.ownerPassHash)) throw new HttpError(401, 'Password is not correct', 'bad_password');
  const key = generateOwnerKey();
  setGroup('security', { ownerKeyHash: hashSecret(normalizeKey(key)) });
  rewrap('owner', key);
  appendLedger('security.owner_key_replaced', sec.ownerUser, {});
  return key;
}

/** Local recovery: `node server.mjs --reset-owner` on this PC. */
export function clearOwner() {
  setGroup('security', { ownerUser: '' }, { clearSecrets: ['ownerPassHash', 'ownerKeyHash'] });
  appendLedger('security.owner_reset_local', 'cli', {});
}
