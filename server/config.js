import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 4321),
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  // How often the background verifier polls providers for pending online payments.
  verifyIntervalMs: Number(process.env.VERIFY_INTERVAL_MS || 5000),
};

export const isLoopbackHost = (h) => ['127.0.0.1', 'localhost', '::1'].includes(h);
