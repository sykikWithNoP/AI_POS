// node:crypto for the phone, built on the audited @noble libraries (synchronous, like Node's API).
// Only what the POS server uses: random bytes, SHA-256, HMAC, scrypt, AES-256-GCM, Ed25519 verify.
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { gcm } from '@noble/ciphers/aes.js';
import { ed25519 } from '@noble/curves/ed25519.js';

const web = globalThis.crypto;
const bytes = (x, enc) => (x instanceof Uint8Array ? x : Buffer.from(typeof x === 'string' ? x : String(x), enc || 'utf8'));
const out = (u8, enc) => { const b = Buffer.from(u8); return enc ? b.toString(enc) : b; };

export function randomBytes(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) web.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  return Buffer.from(b);
}
export const randomUUID = () => web.randomUUID();
export const randomInt = (a, b) => { const [min, max] = b === undefined ? [0, a] : [a, b]; return min + (randomBytes(4).readUInt32BE(0) % (max - min)); };

function hashObj(make) {
  const parts = [];
  return {
    update(d, enc) { parts.push(bytes(d, enc)); return this; },
    digest(enc) { return out(make(Buffer.concat(parts)), enc); },
  };
}
export function createHash(alg) {
  if (String(alg).toLowerCase() !== 'sha256') throw new Error(`hash ${alg} not available`);
  return hashObj((d) => sha256(d));
}
export function createHmac(alg, key) {
  if (String(alg).toLowerCase() !== 'sha256') throw new Error(`hmac ${alg} not available`);
  const k = bytes(key);
  return hashObj((d) => hmac(sha256, k, d));
}
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}
export function scryptSync(password, salt, keylen, opts = {}) {
  return Buffer.from(scrypt(bytes(password), bytes(salt), { N: opts.N || opts.cost || 16384, r: opts.r || opts.blockSize || 8, p: opts.p || opts.parallelization || 1, dkLen: keylen, maxmem: 2 ** 32 }));
}

// AES-256-GCM with Node's streaming shape (update/final/getAuthTag). Data is small, so it is buffered.
export function createCipheriv(alg, key, iv) {
  if (alg !== 'aes-256-gcm') throw new Error(`cipher ${alg} not available`);
  const chunks = []; let tag = null;
  return {
    update(d, enc) { chunks.push(bytes(d, enc)); return Buffer.alloc(0); },
    final() { const ct = gcm(bytes(key), bytes(iv)).encrypt(Buffer.concat(chunks)); tag = Buffer.from(ct.subarray(ct.length - 16)); return Buffer.from(ct.subarray(0, ct.length - 16)); },
    getAuthTag() { return tag; },
  };
}
export function createDecipheriv(alg, key, iv) {
  if (alg !== 'aes-256-gcm') throw new Error(`cipher ${alg} not available`);
  const chunks = []; let tag = null;
  return {
    setAuthTag(t) { tag = bytes(t); return this; },
    update(d, enc) { chunks.push(bytes(d, enc)); return Buffer.alloc(0); },
    final() {
      try { return Buffer.from(gcm(bytes(key), bytes(iv)).decrypt(Buffer.concat([...chunks, tag]))); }
      catch { throw new Error('Unsupported state or unable to authenticate data'); }
    },
  };
}

// Ed25519 keys in PEM (SPKI / PKCS#8): the raw 32-byte key is at the end of the DER.
const der = (pem) => Buffer.from(String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
export function createPublicKey(pem) {
  const d = typeof pem === 'object' && pem.raw ? pem.raw : der(pem.key || pem).subarray(-32);
  return { type: 'public', asymmetricKeyType: 'ed25519', raw: d };
}
export function createPrivateKey(pem) { return { type: 'private', asymmetricKeyType: 'ed25519', raw: der(pem.key || pem).subarray(-32) }; }
export function verify(alg, data, key, sig) {
  const k = key.raw ? key : createPublicKey(key);
  try { return ed25519.verify(bytes(sig), bytes(data), k.raw); } catch { return false; }
}
export function sign(alg, data, key) { return Buffer.from(ed25519.sign(bytes(data), (key.raw ? key : createPrivateKey(key)).raw)); }

export const webcrypto = web;
export default { randomBytes, randomUUID, randomInt, createHash, createHmac, timingSafeEqual, scryptSync, createCipheriv, createDecipheriv, createPublicKey, createPrivateKey, verify, sign, webcrypto };
