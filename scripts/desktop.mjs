// Desktop launcher: what the desktop icon / Start-menu entry / Mac app runs.
//  1. If the POS is already running, just open its window.
//  2. Otherwise start it in the background (no console window), wait until it answers, then open it.
// The window is the browser already on this computer (Edge/Chrome in "app" mode: no address bar or tabs),
// falling back to the default browser. `--background` starts the POS without opening a window
// (used by "Start when this computer starts").
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = fs.existsSync(path.join(here, 'server.mjs'));
const root = bundled ? here : path.resolve(here, '..');
const PORT = Number(process.env.PORT || 4321);
const URL_ = `http://localhost:${PORT}/`;
const background = process.argv.includes('--background');

/** Installed copies keep data in the user's own folder (Program Files / Applications are not for data). */
function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (!fs.existsSync(path.join(root, 'installed.json'))) return path.join(root, 'data');
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'FreeAIPOS', 'data');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Free AI POS');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'free-ai-pos');
}
const DATA = dataDir();

/** Is our POS answering on the port? (Something else on the port is reported as 'other'.) */
function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/auth/state', headers: { host: `localhost:${PORT}` }, timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 4096) res.destroy(); });
      res.on('end', () => { try { const j = JSON.parse(body); resolve('setupRequired' in j || 'authenticated' in j || 'sealed' in j ? 'pos' : 'other'); } catch { resolve('other'); } });
    });
    req.on('timeout', () => { req.destroy(); resolve('none'); });
    req.on('error', () => resolve('none'));
  });
}

function startServer() {
  fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true });
  const log = fs.openSync(path.join(DATA, 'logs', 'pos.log'), 'a');
  const launcher = path.join(root, bundled ? 'launcher.mjs' : 'scripts/launcher.mjs');
  const child = spawn(process.execPath, [launcher], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, DATA_DIR: DATA, POS_DESKTOP: '1' },
  });
  child.unref();
}

const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };

function browserCandidates() {
  if (process.platform === 'win32') {
    const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    return pf.flatMap((d) => [path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')]);
  }
  if (process.platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  }
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];
}

function openWindow() {
  const app = browserCandidates().find(exists);
  const run = (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  if (app) {
    // A separate profile gives the POS its own window and taskbar icon, apart from personal browsing.
    run(app, [`--app=${URL_}`, `--user-data-dir=${path.join(DATA, 'window')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,820']);
    return;
  }
  if (process.platform === 'win32') run('cmd', ['/c', 'start', '', URL_]);
  else if (process.platform === 'darwin') run('open', [URL_]);
  else run('xdg-open', [URL_]);
}

function fail(msg) {
  fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true });
  fs.appendFileSync(path.join(DATA, 'logs', 'pos.log'), `${new Date().toISOString()} [desktop] ${msg}\n`);
  if (process.platform === 'win32') spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${msg.replace(/'/g, "''")}', 'Free AI POS') | Out-Null`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else if (process.platform === 'darwin') spawn('osascript', ['-e', `display alert "Free AI POS" message ${JSON.stringify(msg)}`], { detached: true, stdio: 'ignore' }).unref();
  else console.error(msg);
  process.exitCode = 1;
}

// Recovery: forgot the owner password AND lost the Owner Key. Keeps all data and the PIN.
if (process.argv.includes('--reset-owner')) {
  const entry = path.join(root, bundled ? 'server.mjs' : 'server/index.js');
  const r = spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', entry, '--reset-owner'], { env: { ...process.env, DATA_DIR: DATA }, encoding: 'utf8' });
  const msg = (r.stdout || r.stderr || '').trim() || 'Done.';
  if (process.platform === 'win32') spawnSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${msg.replace(/'/g, "''")}', 'Free AI POS') | Out-Null`], { windowsHide: true });
  else console.log(msg);
  process.exit(r.status ?? 0);
}

const state = await probe();
if (state === 'other') fail(`Another program is using port ${PORT}. Close it, or restart the computer, then open Free AI POS again.`);
else {
  if (state === 'none') {
    startServer();
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = (await probe()) === 'pos'; }
    if (!up) fail(`The POS did not start. Details are in ${path.join(DATA, 'logs', 'pos.log')}`);
    else if (!background) openWindow();
  } else if (!background) openWindow();
}
