// Backups & restore. Backups are consistent SQLite copies (VACUUM INTO) in <data>/backups.
// Restores are validated, staged, and applied by the launcher on restart (the live database is never
// overwritten while open); the data being replaced is kept as a "pre-restore" backup.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db } from '../db.js';
import { config } from '../config.js';
import { badRequest, notFound, log } from '../lib.js';
import { getGroup } from './settings.js';
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
      if (due) createBackup('auto');
    } catch (e) { log.warn('auto backup failed', { err: e.message }); }
  };
  setTimeout(tick, 15_000).unref?.();
  setInterval(tick, 3600_000).unref?.();
}
