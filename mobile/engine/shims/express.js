// A small Express-compatible router for the phone. There is no network server in the app: the host
// passes each /api request straight into this router, in memory. It supports what the POS uses:
// app/Router with get/post/put/delete/use, :params, mounting, error handlers, json/raw bodies and the
// usual req/res helpers.
import { Buffer } from 'buffer';
import fs from './fs.js';

const compile = (path, prefix) => {
  if (path === '/' && prefix) return { re: /^/, keys: [] };
  const keys = [];
  const src = path.replace(/\/+$/, '').replace(/[.+^$|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { re: new RegExp(`^${src}${prefix ? '(?=/|$)' : '/?$'}`, 'i'), keys };
};

function makeRouter() {
  const stack = [];
  const add = (method, path, fns, isUse) => {
    if (typeof path !== 'string') { fns = [path, ...fns]; path = '/'; }
    for (const fn of fns.flat()) stack.push({ method, ...compile(path, isUse), fn, isUse });
  };
  const router = function (req, res, done) { router.handle(req, res, done); };
  router.stack = stack;
  for (const m of ['get', 'post', 'put', 'delete', 'patch']) router[m] = (path, ...fns) => { add(m.toUpperCase(), path, fns, false); return router; };
  router.all = (path, ...fns) => { add(null, path, fns, false); return router; };
  router.use = (path, ...fns) => { add(null, path, fns, true); return router; };
  router.handle = (req, res, done) => {
    let i = 0;
    const basePath = req.path;
    const baseUrl = req.baseUrl || '';
    const next = (err) => {
      req.path = basePath; req.baseUrl = baseUrl;
      while (i < stack.length) {
        const layer = stack[i++];
        if (layer.method && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) continue;
        const m = layer.re.exec(basePath);
        if (!m) continue;
        const isErrorHandler = layer.fn.length === 4;
        if (!!err !== isErrorHandler) continue;
        req.params = { ...(layer.isUse ? req.params : {}), ...Object.fromEntries(layer.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])])) };
        if (layer.isUse && m[0]) { req.baseUrl = baseUrl + m[0]; req.path = basePath.slice(m[0].length) || '/'; }
        try {
          const r = err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
          if (r && typeof r.catch === 'function') r.catch(next);
        } catch (e) { next(e); }
        return;
      }
      done?.(err);
    };
    next();
  };
  return router;
}

export function Router() { return makeRouter(); }

function express() {
  const app = makeRouter();
  app.disable = () => app; app.set = () => app; app.enable = () => app;
  app.listen = () => ({ close() {} });
  return app;
}
express.Router = Router;
express.json = (opts = {}) => (req, res, next) => {
  const ct = String(req.headers['content-type'] || '');
  if (req.body !== undefined || !ct.includes('json') || !req.rawBytes) return next();
  const text = Buffer.from(req.rawBytes).toString('utf8');
  opts.verify?.(req, res, Buffer.from(req.rawBytes));
  if (!text) { req.body = {}; return next(); }
  try { req.body = JSON.parse(text); next(); } catch { next(Object.assign(new Error('Invalid JSON'), { type: 'entity.parse.failed', status: 400 })); }
};
express.raw = () => (req, res, next) => { if (req.body === undefined || !Buffer.isBuffer(req.body)) req.body = Buffer.from(req.rawBytes || []); next(); };
express.static = () => (req, res, next) => next();
express.urlencoded = () => (req, res, next) => next();

/** Build req/res objects for one in-memory request. `onChunk` receives streamed writes (live events). */
export function createExchange({ method, url, headers, body }, { onChunk } = {}) {
  const u = new URL(url, 'http://localhost');
  const listeners = { close: [], finish: [] };
  const req = {
    method, url: u.pathname + u.search, originalUrl: u.pathname + u.search, path: u.pathname, baseUrl: '',
    query: Object.fromEntries(u.searchParams), params: {}, headers, rawBytes: body, body: undefined,
    protocol: 'http', hostname: 'localhost', ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1', destroy() {} },
    get: (h) => headers[String(h).toLowerCase()],
    header: (h) => headers[String(h).toLowerCase()],
    on: (evt, fn) => { (listeners[evt] ||= []).push(fn); return req; },
  };
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const res = {
    statusCode: 200, headers: {}, locals: {}, headersSent: false, finished: false, streaming: false, chunks: [],
    status(c) { this.statusCode = c; return this; },
    set(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) this.headers[a.toLowerCase()] = String(b); else this.headers[k.toLowerCase()] = String(v); return this; },
    header(k, v) { return this.set(k, v); },
    get(k) { return this.headers[k.toLowerCase()]; },
    append(k, v) { const key = k.toLowerCase(); const cur = this.headers[key]; this.headers[key] = cur ? [].concat(cur, v) : [v]; return this; },
    type(t) { this.headers['content-type'] = { json: 'application/json', html: 'text/html; charset=utf-8', text: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8' }[t] || t; return this; },
    json(o) { if (!this.headers['content-type']) this.type('json'); return this.end(JSON.stringify(o ?? null)); },
    send(b) { if (typeof b === 'object' && !(b instanceof Uint8Array)) return this.json(b); if (!this.headers['content-type']) this.type('html'); return this.end(b); },
    sendStatus(c) { return this.status(c).end(''); },
    redirect(a, b) { const [code, loc] = typeof a === 'number' ? [a, b] : [302, a]; this.statusCode = code; this.headers.location = loc; return this.end(''); },
    download(file, name, cb) {
      try {
        const data = fs.readFileSync(file);
        this.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name || String(file).split('/').pop()}"` });
        this.end(data);
        (typeof name === 'function' ? name : cb)?.();
      } catch (e) { this.status(404).json({ error: 'not_found', message: e.message }); }
    },
    attachment(name) { this.set('Content-Disposition', `attachment; filename="${name}"`); return this; },
    writeHead(code, h) { this.statusCode = code; if (h) this.set(h); this.streaming = true; this.headersSent = true; resolveDone(); return this; },
    write(chunk) { if (!this.streaming) { this.chunks.push(chunk); return true; } onChunk?.(String(chunk)); return true; },
    flushHeaders() {},
    end(chunk) {
      if (this.finished) return this;
      if (chunk !== undefined && chunk !== null) this.chunks.push(chunk);
      this.finished = true; this.headersSent = true;
      for (const fn of listeners.finish) try { fn(); } catch { /* ignore */ }
      resolveDone();
      return this;
    },
    on(evt, fn) { (listeners[evt] ||= []).push(fn); return this; },
  };
  const close = () => { for (const fn of listeners.close) try { fn(); } catch { /* ignore */ } };
  return { req, res, done, close };
}

export default express;
