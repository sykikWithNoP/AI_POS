// Composition root. Request flow is one-way:
//   browser -> http (routes/pages) -> services -> db / providers
//   services -> bus -> (SSE to browser, notifications, webhooks, IRD, Telegram, Calendar)
import express from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, isLoopbackHost } from './config.js';
import { HttpError, log } from './lib.js';
import { apiRouter, webhookRouter } from './http/routes.js';
import { pagesRouter } from './http/pages.js';
import { hostGuard } from './http/auth.js';
import { startNotifiers } from './notifiers.js';
import { pollPending } from './services/payments.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(hostGuard(isLoopbackHost(config.host) ? ['localhost', '127.0.0.1', '::1'] : '*'));
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });
  app.use(express.json({ limit: '5mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));

  app.use('/api/webhooks', webhookRouter());
  app.use('/api', apiRouter());
  app.use(pagesRouter());
  app.use('/shared', express.static(path.join(config.root, 'shared')));
  app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'] }));

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startNotifiers();
  const app = createApp();
  app.listen(config.port, config.host, () => {
    log.info('POS ready', { url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}` });
    if (!isLoopbackHost(config.host)) log.warn('Listening beyond localhost: set a PIN in Settings → Security before using other devices.');
  });
  setInterval(() => pollPending().catch((e) => log.warn('poll failed', { err: e.message })), config.verifyIntervalMs).unref();
}
