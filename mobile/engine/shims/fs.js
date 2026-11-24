// node:fs for the phone: a small in-memory file system saved to the app's private storage (IndexedDB).
// Covers the synchronous calls the POS server makes (backups, keys, updates, themes).
import { Buffer } from 'buffer';
import { kvGet, kvSet, onPersist, persistSoon } from '../runtime.js';

const files = new Map();      // path -> { data: Uint8Array, mtime: number }
const dirs = new Set(['/']);
let dirty = false;

const norm = (p) => {
  const parts = [];
  for (const seg of String(p).replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return '/' + parts.join('/');
};
const parent = (p) => norm(p).replace(/\/[^/]*$/, '') || '/';
const err = (code, p) => Object.assign(new Error(`${code}: no such file or directory, '${p}'`), { code });
const changed = () => { dirty = true; persistSoon(); };
const toBytes = (data, enc) => {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return new Uint8Array(Buffer.from(String(data), typeof enc === 'string' ? enc : enc?.encoding || 'utf8'));
};

function ensureDir(p) {
  p = norm(p);
  if (!dirs.has(parent(p)) && p !== '/') throw err('ENOENT', p);
}

export function existsSync(p) { p = norm(p); return files.has(p) || dirs.has(p); }
export function mkdirSync(p, opts = {}) {
  p = norm(p);
  if (dirs.has(p)) return;
  if (opts.recursive) { let cur = ''; for (const seg of p.split('/').filter(Boolean)) { cur += '/' + seg; dirs.add(cur); } }
  else { ensureDir(p); dirs.add(p); }
  changed();
}
export function writeFileSync(p, data, opts) {
  p = norm(p); ensureDir(p);
  files.set(p, { data: toBytes(data, opts), mtime: Date.now() });
  changed();
}
export function appendFileSync(p, data, opts) {
  p = norm(p);
  const prev = files.get(p)?.data || new Uint8Array();
  const add = toBytes(data, opts);
  const out = new Uint8Array(prev.length + add.length); out.set(prev); out.set(add, prev.length);
  writeFileSync(p, out);
}
export function readFileSync(p, opts) {
  p = norm(p);
  const f = files.get(p);
  if (!f) throw err('ENOENT', p);
  const buf = Buffer.from(f.data);
  const enc = typeof opts === 'string' ? opts : opts?.encoding;
  return enc ? buf.toString(enc) : buf;
}
export function readdirSync(p) {
  p = norm(p);
  if (!dirs.has(p)) throw err('ENOENT', p);
  const pre = p === '/' ? '/' : p + '/';
  const names = new Set();
  for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k !== p) names.add(k.slice(pre.length).split('/')[0]);
  return [...names].sort();
}
export function statSync(p) {
  p = norm(p);
  if (dirs.has(p)) return { isDirectory: () => true, isFile: () => false, size: 0, mtime: new Date(0), mtimeMs: 0, mode: 0o755 };
  const f = files.get(p);
  if (!f) throw err('ENOENT', p);
  return { isDirectory: () => false, isFile: () => true, size: f.data.length, mtime: new Date(f.mtime), mtimeMs: f.mtime, mode: 0o644 };
}
export const lstatSync = statSync;
export function rmSync(p, opts = {}) {
  p = norm(p);
  if (files.delete(p)) return changed();
  if (dirs.has(p)) {
    const pre = p + '/';
    const inside = [...files.keys(), ...dirs].some((k) => k.startsWith(pre));
    if (inside && !opts.recursive) throw Object.assign(new Error(`ENOTEMPTY: ${p}`), { code: 'ENOTEMPTY' });
    for (const k of [...files.keys()]) if (k.startsWith(pre)) files.delete(k);
    for (const k of [...dirs]) if (k.startsWith(pre)) dirs.delete(k);
    dirs.delete(p);
    return changed();
  }
  if (!opts.force) throw err('ENOENT', p);
}
export const unlinkSync = (p) => rmSync(p);
export function rm(p, opts, cb) { try { rmSync(p, typeof opts === 'object' ? opts : {}); } catch { /* ignore */ } (typeof opts === 'function' ? opts : cb)?.(null); }
export function renameSync(a, b) {
  a = norm(a); b = norm(b);
  if (files.has(a)) { files.set(b, files.get(a)); files.delete(a); return changed(); }
  if (dirs.has(a)) {
    const pre = a + '/';
    for (const k of [...files.keys()]) if (k.startsWith(pre)) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
    for (const k of [...dirs]) if (k === a || k.startsWith(pre)) { dirs.delete(k); dirs.add(b + k.slice(a.length)); }
    return changed();
  }
  throw err('ENOENT', a);
}
export function copyFileSync(a, b) { writeFileSync(b, readFileSync(a)); }
export function cpSync(a, b) {
  a = norm(a); b = norm(b);
  if (files.has(a)) return copyFileSync(a, b);
  mkdirSync(b, { recursive: true });
  for (const n of readdirSync(a)) cpSync(`${a}/${n}`, `${b}/${n}`);
}
export function accessSync(p) { if (!existsSync(p)) throw err('ENOENT', p); }
export function realpathSync(p) { return norm(p); }
export function statfsSync() { throw Object.assign(new Error('not available on this device'), { code: 'ENOSYS' }); }
export function symlinkSync() { throw Object.assign(new Error('not available on this device'), { code: 'ENOSYS' }); }

// Minimal descriptor API (used to read a file header).
const fds = new Map(); let nextFd = 10;
export function openSync(p) { const f = readFileSync(p); const fd = nextFd++; fds.set(fd, f); return fd; }
export function readSync(fd, buf, off, len, pos) { const f = fds.get(fd); const n = Math.max(0, Math.min(len, f.length - pos)); f.copy(buf, off, pos, pos + n); return n; }
export function closeSync(fd) { fds.delete(fd); }

export const constants = { W_OK: 2, R_OK: 4, F_OK: 0 };

// ---------- load / save ----------
export async function loadFs() {
  const saved = await kvGet('fs');
  if (saved) {
    for (const d of saved.dirs || []) dirs.add(d);
    for (const [k, v] of Object.entries(saved.files || {})) files.set(k, v);
  }
}
onPersist(async () => {
  if (!dirty) return;
  dirty = false;
  await kvSet('fs', { dirs: [...dirs], files: Object.fromEntries(files) });
});

/** For the keep-safe copy: every file except backups (the copy is itself the backup). */
export const exportTree = () => ({
  dirs: [...dirs],
  files: Object.fromEntries([...files].filter(([p]) => !p.startsWith('/data/backups/') && !p.startsWith('/app/'))),
});

/** For the host: read a file as bytes without Buffer (e.g. to share a backup). */
export const peek = (p) => files.get(norm(p))?.data || null;

const fs = { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, statSync, lstatSync, rmSync, unlinkSync, rm, renameSync, copyFileSync, cpSync, accessSync, realpathSync, statfsSync, symlinkSync, openSync, readSync, closeSync, constants };
export default fs;
