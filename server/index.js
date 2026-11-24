// Composition root. Request flow is one-way:
//   browser -> http (routes/pages) -> services -> db / providers
//   services -> bus -> (SSE to browser, notifications, webhooks, IRD, Telegram, Calendar)
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { HttpError, log } from './lib.js';
import { apiRouter, webhookRouter } from './http/routes.js';
import { pagesRouter } from './http/pages.js';
import { localOnly } from './http/auth.js';
import { startNotifiers } from './notifiers.js';
import { pollPending } from './services/payments.js';
import { checkCode } from './security/integrity.js';
import { verify as verifyLedger, append as appendLedger } from './security/ledger.js';
import { notify } from './bus.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(localOnly);
  app.use((req, res, next) => {
    // Strict CSP: only this app's own scripts run (inline scripts need a per-response nonce),
    // nothing is loaded from or sent to other sites (no external images, fonts or scripts),
    // except eSewa's payment form when you choose eSewa at checkout.
    const nonce = crypto.randomBytes(16).toString('base64');
    res.locals.nonce = nonce;
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:", "connect-src 'self'", "frame-src 'self'", "object-src 'none'", "base-uri 'none'",
        "form-action 'self' https://rc-epay.esewa.com.np https://epay.esewa.com.np", "frame-ancestors 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), usb=(), payment=()',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noai, noimageai',
    });
    next();
  });
  app.use(express.json({ type: 'application/json', limit: '5mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));

  app.use('/api/webhooks', webhookRouter());
  app.use('/api', apiRouter());
  app.use(pagesRouter());
  app.use('/shared', express.static(path.join(config.root, 'shared')));
  app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'], dotfiles: 'deny', index: 'index.html' }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Invalid JSON body' });
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) log.error('request failed', { path: req.path, err: err.stack || err.message });
    res.status(status).json({ error: err.code || 'internal', message: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong' : err.message });
  });
  return app;
}

/** Startup self-check: application files vs the sealed manifest, and the signed data ledger. */
export function selfCheck() {
  const code = checkCode(config.root, config.codeDirs);
  if (code.sealed && !code.ok) {
    const detail = { changed: code.changed.slice(0, 20), added: code.added.slice(0, 20), missing: code.missing.slice(0, 20) };
    appendLedger('security.code_modified', 'app', detail);
    log.error('Application files differ from the sealed manifest', detail);
    if (config.strictIntegrity) { console.error('Refusing to start: application files were modified.'); process.exit(78); }
    notify({ type: 'security.code_modified', level: 'error', title: 'Application files were modified', body: [...code.changed, ...code.added, ...code.missing].slice(0, 3).join(', ') });
  }
  const data = verifyLedger();
  if (!data.ok) {
    log.error('Ledger verification failed', { problems: data.problems.slice(0, 5) });
    notify({ type: 'security.tamper', level: 'error', title: 'Tampering detected in records', body: data.problems[0]?.reason || '' });
  }
  return { code, data };
}

const isMain = globalThis.__POS_BUNDLED__ || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isMain && process.argv.includes('--reset-owner')) {
  // Local recovery for a lost owner password AND Owner Key. Needs access to this PC's files;
  // keeps all data and the PIN, and is recorded in the signed ledger.
  const { clearOwner } = await import('./security/owner.js');
  clearOwner();
  console.log('Owner account cleared. Open the POS and create a new owner account (the PIN is required).');
  process.exit(0);
}
if (isMain) {
  selfCheck();
  startNotifiers();
  const app = createApp();
  app.listen(config.port, config.host, () => {
    log.info('POS ready', { url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}` });
  });
  import('./services/ird.js').then((m) => m.startRetryQueue());
  import('./services/backups.js').then((m) => m.startBackupSchedule());
  setInterval(() => pollPending().catch((e) => log.warn('poll failed', { err: e.message })), config.verifyIntervalMs).unref();
}
