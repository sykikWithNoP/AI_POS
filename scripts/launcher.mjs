// Launcher: starts the POS server and restarts it when asked (exit code 75).
// Before each start it applies staged work while the database is closed:
//   1. a staged restore (data/restore-pending.db)
//   2. a staged update (handled by apply-update logic shared with the release build)
// If a freshly updated version fails to start three times in a row, it rolls back automatically.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyStagedUpdate, rollbackUpdate, markHealthy, isProbation } from './updater.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = fs.existsSync(path.join(here, 'server.mjs'));
const root = bundled ? here : path.resolve(here, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const entry = bundled ? path.join(root, 'server.mjs') : path.join(root, 'server', 'index.js');
const RESTART = 75;
const say = (msg) => console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: `[launcher] ${msg}` }));

function applyRestore() {
  const pending = path.join(dataDir, 'restore-pending.db');
  if (!fs.existsSync(pending)) return;
  const live = path.join(dataDir, 'pos.db');
  const aside = path.join(dataDir, 'backups', `replaced-${Date.now()}.db.old`);
  fs.mkdirSync(path.dirname(aside), { recursive: true });
  if (fs.existsSync(live)) fs.renameSync(live, aside);
  for (const ext of ['-wal', '-shm']) fs.rmSync(live + ext, { force: true });
  fs.renameSync(pending, live);
  say('restore applied');
}

let quickFails = 0;
function start() {
  applyRestore();
  const updated = applyStagedUpdate(root, dataDir, say);
  const started = Date.now();
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', entry, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, POS_LAUNCHER: '1' } });
  const healthy = setTimeout(() => { quickFails = 0; markHealthy(root); }, 20_000);
  child.on('exit', (code) => {
    clearTimeout(healthy);
    if (code === RESTART) { say('restarting'); return start(); }
    const quick = Date.now() - started < 20_000;
    if (quick && isProbation(root)) {
      quickFails++;
      if (quickFails >= 3) { say('new version keeps failing to start — rolling back'); rollbackUpdate(root, say); quickFails = 0; return start(); }
      say(`start failed (${quickFails}/3), retrying`); return setTimeout(start, 1000);
    }
    process.exit(code ?? 0);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => child.kill(sig));
  return updated;
}
start();
