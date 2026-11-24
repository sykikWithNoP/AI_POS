// Applies staged updates and rollbacks while the server is stopped. Used by launcher.mjs.
// Layout under the app root:
//   .update/pending.json        { version }  -> files staged in .update/staged/<version>/
//   .update/versions/<v>/       previous versions kept for rollback (newest 3)
//   .update/probation.json      { version, previous } until the new version has run 20s
//   .update/rollback-request.json { to }  manual rollback asked from Settings
import fs from 'node:fs';
import path from 'node:path';

export const APP_FILES = ['server.mjs', 'launcher.mjs', 'updater.mjs', 'desktop.mjs', 'package.json', 'LICENSE', 'USER-GUIDE.md', 'integrity.json', 'public'];
const U = (root, ...p) => path.join(root, '.update', ...p);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const currentVersion = (root) => readJson(path.join(root, 'package.json'))?.version || '0.0.0';

function copyApp(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of APP_FILES) {
    const src = path.join(from, f);
    if (!fs.existsSync(src)) continue;
    fs.rmSync(path.join(to, f), { recursive: true, force: true });
    fs.cpSync(src, path.join(to, f), { recursive: true });
  }
}

function swapTo(root, sourceDir, keepAs, say) {
  const keep = U(root, 'versions', keepAs);
  fs.rmSync(keep, { recursive: true, force: true });
  copyApp(root, keep);                // keep the running version
  copyApp(sourceDir, root);           // install the new one
  say?.(`installed files from ${path.basename(sourceDir)}; kept ${keepAs}`);
}

export function applyStagedUpdate(root, dataDir, say) {
  if (!fs.existsSync(path.join(root, 'server.mjs'))) return false; // source checkout: updates don't apply
  const rb = readJson(U(root, 'rollback-request.json'));
  if (rb?.to) {
    fs.rmSync(U(root, 'rollback-request.json'), { force: true });
    const dir = U(root, 'versions', rb.to);
    if (fs.existsSync(dir)) {
      const from = currentVersion(root);
      swapTo(root, dir, from, say);
      fs.writeFileSync(U(root, 'last-change.json'), JSON.stringify({ kind: 'rollback', from, to: rb.to, at: new Date().toISOString() }));
      say?.(`rolled back ${from} -> ${rb.to}`);
      return true;
    }
  }
  const pending = readJson(U(root, 'pending.json'));
  if (!pending?.version) return false;
  const staged = U(root, 'staged', pending.version);
  fs.rmSync(U(root, 'pending.json'), { force: true });
  if (!fs.existsSync(staged)) { say?.('staged update missing; skipped'); return false; }
  const from = currentVersion(root);
  swapTo(root, staged, from, say);
  fs.rmSync(staged, { recursive: true, force: true });
  fs.writeFileSync(U(root, 'probation.json'), JSON.stringify({ version: pending.version, previous: from }));
  fs.writeFileSync(U(root, 'last-change.json'), JSON.stringify({ kind: 'update', from, to: pending.version, at: new Date().toISOString() }));
  say?.(`updated ${from} -> ${pending.version}`);
  return true;
}

export const isProbation = (root) => fs.existsSync(U(root, 'probation.json'));

export function markHealthy(root) {
  if (!isProbation(root)) return;
  fs.rmSync(U(root, 'probation.json'), { force: true });
  // Keep the newest 3 previous versions.
  const dir = U(root, 'versions');
  if (!fs.existsSync(dir)) return;
  const vs = fs.readdirSync(dir).sort((a, b) => cmp(b, a));
  for (const v of vs.slice(3)) fs.rmSync(path.join(dir, v), { recursive: true, force: true });
}

export function rollbackUpdate(root, say) {
  const p = readJson(U(root, 'probation.json'));
  fs.rmSync(U(root, 'probation.json'), { force: true });
  if (!p?.previous) return;
  const dir = U(root, 'versions', p.previous);
  if (!fs.existsSync(dir)) return;
  copyApp(dir, root);
  fs.writeFileSync(U(root, 'last-change.json'), JSON.stringify({ kind: 'auto-rollback', from: p.version, to: p.previous, at: new Date().toISOString() }));
  say?.(`automatic rollback ${p.version} -> ${p.previous}`);
}

/** Semantic version compare: -1 / 0 / 1 */
export function cmp(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0), pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1; }
  return 0;
}
