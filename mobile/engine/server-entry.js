// Starts the POS engine inside the app: the same composition as the computer edition's server/index.js
// (self-check, notifiers, IRD retry queue, automatic backups, payment verification), minus the network
// listener and anything that only makes sense on a computer.
import fs from './shims/fs.js';

// Built-in files the server reads (the user guide and the extension sandbox runtime).
fs.mkdirSync('/app', { recursive: true });
fs.writeFileSync('/app/USER-GUIDE.md', globalThis.__POS_GUIDE__ || '# User guide');
globalThis.__POS_SANDBOX__ = globalThis.__POS_SANDBOX_JS__;

const { createApp, selfCheck } = await import('../../server/index.js');
const { startNotifiers } = await import('../../server/notifiers.js');
const { pollPending } = await import('../../server/services/payments.js');
const { config } = await import('../../server/config.js');
const { log } = await import('../../server/lib.js');
export const { exportSessions, importSessions } = await import('../../server/http/auth.js');

const express = (await import('./shims/express.js')).default;
const { requireAuth } = await import('../../server/http/auth.js');
const { mobileRouter } = await import('./routes.js');

export function start() {
  selfCheck();
  startNotifiers();
  const pos = createApp();
  // Phone-only routes sit in front of the regular POS routes.
  const app = express();
  app.use('/api/mobile', mobileRouter(requireAuth));
  app.use(pos);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));
  import('../../server/services/ird.js').then((m) => m.startRetryQueue());
  import('../../server/services/backups.js').then((m) => m.startBackupSchedule());
  setInterval(() => pollPending().catch((e) => log.warn('poll failed', { err: e.message })), config.verifyIntervalMs);
  return app;
}
