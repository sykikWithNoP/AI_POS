// Small node: modules for the phone (path, os, url, events, zlib, vm, net, child_process).
import { inflateSync, deflateSync } from 'fflate';
import { Buffer } from 'buffer';

// ---------- path (POSIX) ----------
const normalize = (p) => {
  const abs = String(p).startsWith('/');
  const out = [];
  for (const seg of String(p).split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg); }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
};
export const path = {
  sep: '/', delimiter: ':',
  normalize,
  join: (...a) => normalize(a.filter((x) => x !== '').join('/')),
  resolve: (...a) => { let r = ''; for (const x of a) r = String(x).startsWith('/') ? x : `${r}/${x}`; return normalize(r.startsWith('/') ? r : `/${r}`); },
  dirname: (p) => { const n = normalize(p); const i = n.lastIndexOf('/'); return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i); },
  basename: (p, ext) => { const b = normalize(p).split('/').pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
  extname: (p) => { const b = normalize(p).split('/').pop() || ''; const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
  isAbsolute: (p) => String(p).startsWith('/'),
  relative: (from, to) => { const a = normalize(from).split('/').filter(Boolean), b = normalize(to).split('/').filter(Boolean); let i = 0; while (i < a.length && a[i] === b[i]) i++; return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/'); },
};
path.posix = path;

// ---------- os ----------
export const os = {
  homedir: () => '/home', tmpdir: () => '/tmp', platform: () => globalThis.process?.platform || 'android',
  userInfo: () => ({ username: 'pos' }), hostname: () => 'phone', EOL: '\n', type: () => 'Mobile', release: () => '', arch: () => '',
};

// ---------- url ----------
export const fileURLToPath = (u) => decodeURIComponent(new URL(String(u), 'file:///').pathname);
export const pathToFileURL = (p) => new URL(`file://${encodeURI(String(p ?? ''))}`);
export const url = { fileURLToPath, pathToFileURL, URL, URLSearchParams };

// ---------- events ----------
export class EventEmitter {
  constructor() { this._ev = new Map(); }
  setMaxListeners() { return this; }
  on(e, fn) { (this._ev.get(e) || this._ev.set(e, []).get(e)).push(fn); return this; }
  addListener(e, fn) { return this.on(e, fn); }
  once(e, fn) { const w = (...a) => { this.off(e, w); fn(...a); }; return this.on(e, w); }
  off(e, fn) { const l = this._ev.get(e); if (l) this._ev.set(e, l.filter((x) => x !== fn)); return this; }
  removeListener(e, fn) { return this.off(e, fn); }
  emit(e, ...a) { const l = this._ev.get(e); if (!l?.length) return false; for (const fn of [...l]) fn(...a); return true; }
  listenerCount(e) { return this._ev.get(e)?.length || 0; }
}
export const events = { EventEmitter, default: EventEmitter };

// ---------- zlib (raw deflate, for ZIP files) ----------
export const zlib = {
  inflateRawSync: (b) => Buffer.from(inflateSync(new Uint8Array(b))),
  deflateRawSync: (b) => Buffer.from(deflateSync(new Uint8Array(b))),
};

// ---------- vm: syntax check only (extensions are never run here) ----------
export const vm = {
  Script: class {
    constructor(code) {
      try { new Function(code); } catch (e) { if (e instanceof SyntaxError) throw e; /* eval blocked: skip check */ }
    }
  },
};

// ---------- not available on a phone ----------
const unavailable = (what) => () => { throw Object.assign(new Error(`${what} is not available on a phone — use "browser" printing or share the e-bill`), { code: 'ENOSYS' }); };
export const net = { createConnection: unavailable('Network receipt printing'), connect: unavailable('Network receipt printing'), Socket: class { constructor() { unavailable('Network receipt printing')(); } } };
export const childProcess = { execFile: (cmd, args, opts, cb) => (typeof opts === 'function' ? opts : cb)?.(new Error('Printer queues are not available on a phone')), spawn: unavailable('Running programs'), spawnSync: unavailable('Running programs') };
