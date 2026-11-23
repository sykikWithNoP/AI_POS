// Code integrity: at startup, hash every application file and compare with the sealed manifest
// (integrity.json, written by `npm run seal` / the release build). A mismatch is logged to the ledger,
// raised as a notification, and — with POS_STRICT_INTEGRITY=1 (on by default in release builds) — stops the server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const INCLUDE = ['server', 'shared', 'public'];
const EXCLUDE = /(^|\/)(node_modules|data|\.git)(\/|$)|\.map$/;

export function hashTree(root, dirs = INCLUDE) {
  const files = {};
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) { for (const f of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, f)); return; }
    if (EXCLUDE.test(rel)) return;
    files[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  };
  for (const d of dirs) walk(d);
  return files;
}

export function seal(root, dirs = INCLUDE) {
  const files = hashTree(root, dirs);
  const manifest = { sealedAt: new Date().toISOString(), files, root: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex') };
  fs.writeFileSync(path.join(root, 'integrity.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

/** { sealed, ok, changed: [], added: [], missing: [] } */
export function checkCode(root, dirs = INCLUDE) {
  const file = path.join(root, 'integrity.json');
  if (!fs.existsSync(file)) return { sealed: false, ok: true, changed: [], added: [], missing: [] };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = hashTree(root, dirs);
  const changed = [], added = [], missing = [];
  for (const [f, h] of Object.entries(manifest.files)) { if (!(f in now)) missing.push(f); else if (now[f] !== h) changed.push(f); }
  for (const f of Object.keys(now)) if (!(f in manifest.files)) added.push(f);
  return { sealed: true, sealedAt: manifest.sealedAt, ok: !changed.length && !added.length && !missing.length, changed, added, missing };
}
