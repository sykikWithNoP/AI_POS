import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// In a release build everything is bundled into dist/server.mjs, so the app root is that folder.
export const BUNDLED = !!globalThis.__POS_BUNDLED__;
const root = BUNDLED ? here : path.resolve(here, '..');

export const config = {
  root,
  // Local-only by design: the POS always binds to the loopback interface. There is no LAN mode.
  host: '127.0.0.1',
  port: Number(process.env.PORT || 4321),
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  // How often the background verifier polls providers for pending online payments.
  verifyIntervalMs: Number(process.env.VERIFY_INTERVAL_MS || 5000),
  // Refuse to start if app files differ from the sealed manifest. Default on in release builds.
  strictIntegrity: process.env.POS_STRICT_INTEGRITY ? process.env.POS_STRICT_INTEGRITY === '1' : BUNDLED,
  codeDirs: BUNDLED ? ['server.mjs', 'launcher.mjs', 'updater.mjs', 'public'] : ['server', 'shared', 'public'],
};

export const isLoopbackHost = (h) => ['127.0.0.1', 'localhost', '::1'].includes(h);

// Host names the dashboard answers to. Anything else (LAN IPs, tunnel domains, rebinding tricks) is refused.
export const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1'];
