// Backups & restore. Backups are consistent SQLite copies (VACUUM INTO) in <data>/backups.
// Restores are validated, staged, and applied by the launcher on restart (the live database is never
// overwritten while open); the data being replaced is kept as a "pre-restore" backup.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db } from '../db.js';
import { config } from '../config.js';
import { badRequest, notFound, log } from '../lib.js';
import os from 'node:os';
import { getGroup, setGroup } from './settings.js';
import { append as appendLedger } from '../security/ledger.js';
import { notify } from '../bus.js';

export const backupDir = () => path.join(config.dataDir, 'backups');
const NAME = /^pos-\d{8}-\d{6}-[a-z-]{1,20}\.db$/;
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
export const RESTORE_PENDING = () => path.join(config.dataDir, 'restore-pending.db');

export function createBackup(reason = 'manual') {
  fs.mkdirSync(backupDir(), { recursive: true });
  const name = `pos-${stamp()}-${String(reason).toLowerCase().replace(/[^a-z-]/g, '').slice(0, 20) || 'manual'}.db`;
  const file = path.join(backupDir(), name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  appendLedger('backup.created', name, { reason, bytes: fs.statSync(file).size });
  prune();
  return info(name);
}

function info(name) {
  const st = fs.statSync(path.join(backupDir(), name));
  return { name, bytes: st.size, created: st.mtime.toISOString(), reason: name.replace(/^pos-\d{8}-\d{6}-|\.db$/g, '') };
}

export function listBackups() {
  if (!fs.existsSync(backupDir())) return [];
  return fs.readdirSync(backupDir()).filter((f) => NAME.test(f)).map(info).sort((a, b) => b.name.localeCompare(a.name));
}

export function backupPath(name) {
  if (!NAME.test(String(name))) throw badRequest('Invalid backup name');
  const p = path.join(backupDir(), name);
  if (!fs.existsSync(p)) throw notFound('Backup');
  return p;
}

/** Keep the newest `keep` automatic backups; manual and pre-restore/pre-update backups are kept longer (x3). */
export function prune() {
  const keep = Math.max(3, Number(getGroup('backup').keep) || 14);
  const all = listBackups();
  const auto = all.filter((b) => b.reason === 'auto');
  const other = all.filter((b) => b.reason !== 'auto');
  for (const b of [...auto.slice(keep), ...other.slice(keep * 3)]) fs.rmSync(path.join(backupDir(), b.name), { force: true });
}

/** Check that a file is an intact POS database before it may replace the live one. */
export function validateDbFile(file) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\u0000') throw badRequest('That file is not a POS backup (not an SQLite database)');
  let cand;
  try {
    cand = new DatabaseSync(file, { readOnly: true });
    const ok = cand.prepare('PRAGMA integrity_check').get();
    if (Object.values(ok)[0] !== 'ok') throw badRequest('Backup is damaged (integrity check failed)');
    const tables = new Set(cand.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
    for (const t of ['settings', 'items', 'sales', 'sale_items', 'payments', 'ledger']) if (!tables.has(t)) throw badRequest(`Backup is missing the ${t} table`);
    const counts = { sales: cand.prepare('SELECT COUNT(*) AS n FROM sales').get().n, items: cand.prepare('SELECT COUNT(*) AS n FROM items').get().n, ledger: cand.prepare('SELECT COUNT(*) AS n FROM ledger').get().n };
    const last = cand.prepare('SELECT MAX(created_at) AS t FROM sales').get().t;
    return { ...counts, lastSale: last };
  } finally { try { cand?.close(); } catch { /* ignore */ } }
}

/** Stage a restore from a stored backup name or an uploaded buffer. Applied by the launcher on restart. */
export function stageRestore({ name, buffer }) {
  const tmp = RESTORE_PENDING() + '.tmp';
  if (name) fs.copyFileSync(backupPath(name), tmp);
  else if (buffer?.length) fs.writeFileSync(tmp, buffer);
  else throw badRequest('Choose a backup');
  let summary;
  try { summary = validateDbFile(tmp); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  createBackup('pre-restore');
  fs.renameSync(tmp, RESTORE_PENDING());
  appendLedger('backup.restore_staged', name || 'upload', summary);
  notify({ type: 'backup.restore', level: 'warn', title: 'Restore ready — restart to apply', body: `${summary.sales} bills, ${summary.items} items` });
  return { staged: true, summary };
}

export function cancelRestore() { fs.rmSync(RESTORE_PENDING(), { force: true }); return { cancelled: true }; }
export const restorePending = () => fs.existsSync(RESTORE_PENDING());

/** Hourly check: make an automatic backup when the last one is older than everyHours. */
export function startBackupSchedule() {
  const tick = async () => {
    if ((await import('../lib.js')).isLocked()) return;
    try {
      const cfg = getGroup('backup');
      if (!cfg.auto) return;
      const last = listBackups().find((b) => b.reason === 'auto');
      const due = !last || Date.now() - Date.parse(last.created) >= Math.max(1, cfg.everyHours) * 3600_000;
      if (due) {
        const b = createBackup('auto');
        if (cfg.externalDir) { try { copyOut(b.name, cfg.externalDir); } catch (e) { notify({ type: 'backup.external_failed', level: 'warn', title: 'Could not copy the backup to your backup folder', body: `${e.message} — check Settings › Data.` }); } }
      }
    } catch (e) { log.warn('auto backup failed', { err: e.message }); }
  };
  setTimeout(tick, 15_000).unref?.();
  setInterval(tick, 3600_000).unref?.();
}

// ---------- copies off this computer (USB stick, external disk, synced folder) ----------

const OUT_DIR = 'NINDITOPOS-backups';

/** Drives and folders a backup can be copied to: USB sticks / external disks, best effort per OS. */
export function listDrives() {
  const out = [];
  const add = (p, label) => {
    try {
      const st = fs.statSync(p);
      if (!st.isDirectory()) return;
      fs.accessSync(p, fs.constants.W_OK);
      let free = null; try { const f = fs.statfsSync(p); free = f.bavail * f.bsize; } catch { /* unknown */ }
      out.push({ path: p, label: label || path.basename(p) || p, free });
    } catch { /* not writable / not mounted */ }
  };
  if (process.platform === 'win32') {
    const sys = (process.env.SystemDrive || 'C:').toUpperCase();
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') if (`${l}:` !== sys) add(`${l}:\\`, `Drive ${l}:`);
  } else if (process.platform === 'darwin') {
    try { for (const v of fs.readdirSync('/Volumes')) { const p = path.join('/Volumes', v); try { if (fs.realpathSync(p) !== '/') add(p, v); } catch { /* skip */ } } } catch { /* none */ }
  } else {
    const user = os.userInfo().username;
    for (const base of [`/media/${user}`, `/run/media/${user}`, '/media', '/mnt']) {
      try { for (const v of fs.readdirSync(base)) { if (v === user) continue; add(path.join(base, v), v); } } catch { /* none */ }
    }
  }
  return out;
}

function checkFolder(dir) {
  const d = String(dir || '').trim();
  if (!d || !path.isAbsolute(d)) throw badRequest('Choose a drive or type a full folder path');
  if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw badRequest('That drive or folder is not there — is the USB stick plugged in?');
  const real = fs.realpathSync(d);
  if (real.startsWith(fs.realpathSync(config.root)) || real.startsWith(path.resolve(config.dataDir))) throw badRequest('Pick a place outside the POS folder (a USB stick, another disk or a synced folder)');
  return real;
}

function copyOut(name, dir) {
  const target = path.join(checkFolder(dir), OUT_DIR);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(backupPath(name), path.join(target, name));
  // Keep the newest 10 copies on the drive.
  const mine = fs.readdirSync(target).filter((f) => NAME.test(f)).sort().reverse();
  for (const f of mine.slice(10)) fs.rmSync(path.join(target, f), { force: true });
  const at = new Date().toISOString();
  setGroup('backup', { lastExternalAt: at });
  appendLedger('backup.copied', name, { to: 'external' });
  return { ok: true, folder: target, name, at };
}

/** Make a fresh backup and copy it to a USB stick / folder. */
export function backupTo(dir) {
  checkFolder(dir);
  const b = createBackup('manual');
  return copyOut(b.name, dir);
}

/** Days since the last copy off this computer (null = never). */
export function externalAge() {
  const at = getGroup('backup').lastExternalAt;
  return at ? Math.floor((Date.now() - Date.parse(at)) / 86_400_000) : null;
}

export function reminder() {
  const cfg = getGroup('backup');
  const days = externalAge();
  const due = days === null ? listBackups().length > 0 || Number(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n) > 0 : days >= (Number(cfg.remindDays) || 7);
  return { due, days, remindDays: Number(cfg.remindDays) || 7 };
}
