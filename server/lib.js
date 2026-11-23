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

// --- At-rest encryption for provider secrets (AES-256-GCM, key file next to the DB) ---
let masterKey;
function key() {
  if (masterKey) return masterKey;
  if (process.env.POS_SECRET_KEY) {
    masterKey = crypto.createHash('sha256').update(process.env.POS_SECRET_KEY).digest();
    return masterKey;
  }
  const file = path.join(config.dataDir, 'secret.key');
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  masterKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  return masterKey;
}
/** Purpose-bound sub-key (e.g. 'ledger') derived from the master key. */
export function deriveKey(label) {
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

/** fetch with a timeout; returns { ok, status, json, text }. Never throws on HTTP status. */
export async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
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
