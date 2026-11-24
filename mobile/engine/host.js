// NINDITO POS Mobile — in-app host. The whole POS (the same server code as the computer edition) runs
// inside the app. There is no network server: requests the screens make to /api go straight into the
// engine in memory, live events are delivered in memory, and data is saved in the app's own storage.
// Only the services the owner switches on (payments, IRD, AI…) are contacted, through the same privacy gate.
import { Buffer } from 'buffer';
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import { setSqlModule, kvGet, kvSet, persistNow, MAIN_DB, getMainDb } from './runtime.js';
import { loadFs, peek, exportTree } from './shims/fs.js';
import { initKeep, rememberOwnerKey, adoptRestored, keepStatus, writeCopy } from './keep.js';
import { startChoice } from './start-choice.js';
import fs from './shims/fs.js';
import { createExchange } from './shims/express.js';

// The browser Buffer library lacks Node's 'base64url' encoding (used for tokens): add it.
{
  const toStr = Buffer.prototype.toString;
  Buffer.prototype.toString = function (enc, ...rest) {
    if (enc === 'base64url') return toStr.call(this, 'base64', ...rest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return toStr.call(this, enc, ...rest);
  };
  const from = Buffer.from;
  Buffer.from = function (v, enc, ...rest) {
    if (enc === 'base64url' && typeof v === 'string') return from.call(this, v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return from.call(this, v, enc, ...rest);
  };
}
globalThis.Buffer = Buffer;
globalThis.global = globalThis;
const platform = globalThis.Capacitor?.getPlatform?.() || 'web';
globalThis.process = globalThis.process || {
  env: { DATA_DIR: '/data', NODE_ENV: 'production', POS_MOBILE: '1' },
  platform: platform === 'ios' ? 'darwin' : 'android', versions: { node: '22.23.5' }, argv: [], execPath: '/app/pos',
  cwd: () => '/app', exit: () => {}, on: () => {}, once: () => {}, nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)),
  memoryUsage: () => ({ rss: 0 }), uptime: () => performance.now() / 1000, hrtime: { bigint: () => BigInt(Math.round(performance.now() * 1e6)) },
};
globalThis.__POS_MOBILE__ = { platform, version: globalThis.__POS_MOBILE_VERSION__ };

const nativeFetch = globalThis.fetch.bind(globalThis);
let app = null;
const jar = new Map();             // cookies the engine sets (sessions, owner sign-in)

const isEngineUrl = (u) => {
  try { const x = new URL(u, location.href); return x.origin === location.origin && /^\/(api\/|b\/|guide$|pay\/)/.test(x.pathname); } catch { return false; }
};

async function bodyBytes(body) {
  if (body == null) return null;
  if (typeof body === 'string') return new Uint8Array(Buffer.from(body, 'utf8'));
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof URLSearchParams) return new Uint8Array(Buffer.from(body.toString()));
  return new Uint8Array(Buffer.from(String(body)));
}

/** Run one request through the engine. Returns the res object (and keeps streams open for live events). */
async function dispatchToEngine(url, init = {}, stream) {
  const headers = {};
  new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
  headers.host = 'localhost';
  headers.origin ??= init.method && init.method !== 'GET' ? 'http://localhost' : undefined;
  if (headers.origin === undefined) delete headers.origin;
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const x = createExchange({ method: (init.method || 'GET').toUpperCase(), url: new URL(url, location.href).pathname + new URL(url, location.href).search, headers, body: await bodyBytes(init.body) }, stream);
  app.handle(x.req, x.res, () => { if (!x.res.finished) x.res.status(404).json({ error: 'not_found', message: 'No such endpoint' }); });
  await x.done;
  for (const c of [].concat(x.res.headers['set-cookie'] || [])) {
    const [pair, ...attrs] = String(c).split(';');
    const [k, v] = pair.split('=');
    if (attrs.some((a) => /max-age=0\b/i.test(a)) || v === '') jar.delete(k.trim()); else jar.set(k.trim(), v);
  }
  return x;
}

function toResponse(res) {
  const body = res.chunks.length ? Buffer.concat(res.chunks.map((c) => (c instanceof Uint8Array ? Buffer.from(c) : Buffer.from(String(c))))) : null;
  const h = new Headers();
  for (const [k, v] of Object.entries(res.headers)) if (k !== 'set-cookie') h.set(k, Array.isArray(v) ? v.join(', ') : v);
  return new Response(res.statusCode === 204 || res.statusCode === 304 ? null : body, { status: res.statusCode, headers: h });
}

// ---------- fetch: /api goes to the engine, everything else to the network (native on the phone) ----------
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!isEngineUrl(url)) return nativeFetch(input, init);
  if (typeof input !== 'string') init = { method: input.method, headers: input.headers, body: input.method !== 'GET' ? await input.arrayBuffer() : undefined, ...init };
  await ready;
  const x = await dispatchToEngine(url, init);
  // Anything that changed data is saved to the phone before the screen gets its answer,
  // so closing or reloading the app right after a sale never loses it.
  if ((init.method || 'GET').toUpperCase() !== 'GET') await persistNow();
  noteOwnerKey(new URL(url, location.href).pathname, init, x.res).catch(() => {});
  return toResponse(x.res);
};

// ---------- live events (EventSource('/api/events')) ----------
const NativeES = globalThis.EventSource;
class EngineEventSource extends EventTarget {
  constructor(url) {
    super();
    this.url = url; this.readyState = 0;
    let buf = '';
    ready.then(() => dispatchToEngine(url, {}, { onChunk: (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let type = 'message', data = '';
        for (const line of block.split('\n')) { if (line.startsWith('event: ')) type = line.slice(7); else if (line.startsWith('data: ')) data += line.slice(6); }
        if (data) this.dispatchEvent(new MessageEvent(type, { data }));
      }
    } })).then((x) => { this.exchange = x; this.readyState = 1; this.dispatchEvent(new Event('open')); });
  }
  close() { this.readyState = 2; this.exchange?.close(); }
}
globalThis.EventSource = function (url, opts) { return isEngineUrl(url) ? new EngineEventSource(url) : new NativeES(url, opts); };

// ---------- pages the engine renders (e-bill, guide) and downloads ----------
function viewer(title) {
  document.querySelector('.m-viewer')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'm-viewer';
  wrap.innerHTML = '<header><button type="button" class="m-close" aria-label="Close">✕ Close</button><b></b><button type="button" class="m-share">Share</button></header><iframe title="Page"></iframe>';
  wrap.querySelector('b').textContent = title;
  wrap.querySelector('.m-close').onclick = () => wrap.remove();
  document.body.append(wrap);
  return wrap;
}

async function showEnginePage(url, title) {
  const x = await dispatchToEngine(url, {});
  const html = toResponse(x.res);
  const v = viewer(title);
  const frame = v.querySelector('iframe');
  frame.srcdoc = (await html.text()).replace('<head>', `<head><base href="${location.origin}/">`);
  v.querySelector('.m-share').onclick = () => shareText(title, frame.contentDocument?.body?.innerText || '');
  return frame;
}

async function shareText(title, text) {
  const Share = globalThis.Capacitor?.Plugins?.Share;
  try {
    if (Share) await Share.share({ title, text, dialogTitle: title });
    else if (navigator.share) await navigator.share({ title, text });
    else await navigator.clipboard.writeText(text);
  } catch { /* cancelled */ }
}

async function saveFile(name, bytes, type) {
  const P = globalThis.Capacitor?.Plugins;
  if (P?.Filesystem && P?.Share) {
    const r = await P.Filesystem.writeFile({ path: name, data: Buffer.from(bytes).toString('base64'), directory: 'CACHE' });
    await P.Share.share({ title: name, files: [r.uri], dialogTitle: `Save or send ${name}` });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

async function downloadFromEngine(url) {
  const x = await dispatchToEngine(url, {});
  const r = toResponse(x.res);
  if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.message || 'Download failed'); return; }
  const disp = r.headers.get('content-disposition') || '';
  const name = /filename="?([^";]+)"?/.exec(disp)?.[1] || new URL(url, location.href).pathname.split('/').pop();
  await saveFile(name, new Uint8Array(await r.arrayBuffer()), r.headers.get('content-type'));
}

const nativeOpen = window.open.bind(window);
window.open = (url = '', target, features) => {
  if (url && isEngineUrl(url)) {
    const p = new URL(url, location.href).pathname;
    showEnginePage(url, p.startsWith('/b/') ? 'Bill' : p === '/guide' ? 'User guide' : 'NINDITO POS');
    return null;
  }
  if (!url) {
    // Print views write their own document: show them in the in-app viewer.
    const v = viewer('Print view');
    const frame = v.querySelector('iframe');
    v.querySelector('.m-share').onclick = () => shareText('NINDITO POS', frame.contentDocument?.body?.innerText || '');
    frame.srcdoc = '<!doctype html><html><head></head><body></body></html>';
    return frame.contentWindow;
  }
  if (/^https?:/i.test(url) && new URL(url).origin !== location.origin) {
    const B = globalThis.Capacitor?.Plugins?.Browser;
    if (B) { B.open({ url }); return null; }
  }
  return nativeOpen(url, target, features);
};

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#') || !isEngineUrl(href)) return;
  e.preventDefault();
  const p = new URL(href, location.href).pathname;
  if (p.startsWith('/api/')) downloadFromEngine(href); else window.open(href);
}, true);

// <img src="/api/…"> (payment QR codes, theme pictures) → served from the engine as blob URLs
const imgCache = new Map();
async function fixImg(img) {
  const src = img.getAttribute('src');
  if (!src || !src.startsWith('/api/')) return;
  img.removeAttribute('src');
  if (!imgCache.has(src)) imgCache.set(src, (async () => { const r = toResponse((await dispatchToEngine(src, {})).res); return URL.createObjectURL(await r.blob()); })());
  img.src = await imgCache.get(src);
}
new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === 'attributes' && m.target.tagName === 'IMG') fixImg(m.target);
    for (const n of m.addedNodes || []) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') fixImg(n);
      n.querySelectorAll?.('img[src^="/api/"]').forEach(fixImg);
    }
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });

// ---------- boot ----------
/** The Owner Key passes through here at setup, sign-in and "new key": lock the keep-safe copy with it. */
async function noteOwnerKey(path, init, res) {
  if (res.statusCode >= 300 || !/^\/api\/auth\/(setup|owner\/(login|setup|new-key))$/.test(path)) return;
  let key = null;
  try { key = JSON.parse(Buffer.concat(res.chunks.map((c) => Buffer.from(c))).toString()).ownerKey; } catch { /* no body */ }
  if (!key && path.endsWith('/login')) { try { key = JSON.parse(String(init.body || '{}')).key; } catch { /* ignore */ } }
  if (key) await rememberOwnerKey(key);
}

async function boot() {
  const SQL = await initSqlJs({ locateFile: () => 'sql-wasm.wasm' });
  setSqlModule(SQL);
  // Fresh install: start a new shop, or restore the copy that survived uninstalling.
  if (!(await kvGet('db'))) {
    const restored = await startChoice();
    if (restored) {
      await kvSet('db', restored.db);
      await kvSet('fs', { dirs: restored.dirs, files: restored.files });
      await adoptRestored(restored.keep);
    }
  }
  await loadFs();
  fs.mkdirSync('/data', { recursive: true });
  // A restore chosen in Settings › Data is applied on the next start (like the computer edition).
  const pending = peek('/data/restore-pending.db');
  if (pending) {
    const old = await kvGet('db');
    if (old) fs.writeFileSync(`/data/backups/replaced-${Date.now()}.db.old`, old);
    await kvSet('db', pending);
    fs.rmSync('/data/restore-pending.db', { force: true });
  }
  globalThis.__POS_DB_BYTES__ = await kvGet('db');
  void MAIN_DB;
  const engine = await import('./server-entry.js');
  app = engine.start();
  await initKeep(() => {
    const db = getMainDb();
    const count = (sql) => { try { return db.raw.exec(sql)[0]?.values[0][0] ?? 0; } catch { return 0; } };
    return { db: db.raw.export(), ...exportTree(), summary: { bills: count('SELECT COUNT(*) FROM sales'), items: count('SELECT COUNT(*) FROM items') } };
  });
  globalThis.__POS_KEEP__ = { status: keepStatus, saveNow: writeCopy };
  // Sign-ins survive a reload of the screens (not a full close of the app).
  try {
    const saved = JSON.parse(sessionStorage.getItem('pos.engine.sessions') || 'null');
    if (saved) { engine.importSessions(saved.server); for (const [k, v] of saved.jar || []) jar.set(k, v); }
  } catch { /* start signed out */ }
  addEventListener('pagehide', () => {
    try { sessionStorage.setItem('pos.engine.sessions', JSON.stringify({ server: engine.exportSessions(), jar: [...jar] })); } catch { /* ignore */ }
  });
  await persistNow();
}
const ready = boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<main style="padding:24px;font-family:system-ui"><h1>NINDITO POS could not start</h1><p>${String(e.message || e).replace(/</g, '&lt;')}</p></main>`;
  throw e;
});
globalThis.__POS_ENGINE_READY__ = ready;

// Save before the app goes to the background.
document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow().catch(() => {}); });
globalThis.Capacitor?.Plugins?.App?.addListener?.('pause', () => persistNow().catch(() => {}));
