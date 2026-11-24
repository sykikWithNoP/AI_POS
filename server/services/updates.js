// Offline, signed updates. An update is a .posupdate file (ZIP) containing the new app files, a manifest
// with every file's SHA-256, and an Ed25519 signature over the manifest. Only packages signed with YOUR
// private key (see `npm run keygen`) are accepted. Nothing is downloaded from the internet.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, BUNDLED } from '../config.js';
import { badRequest, HttpError } from '../lib.js';
import { unzip } from '../util/zip.js';
import { createBackup } from './backups.js';
import { append as appendLedger } from '../security/ledger.js';
import { notify } from '../bus.js';

const ALLOWED = /^(server\.mjs|launcher\.mjs|updater\.mjs|package\.json|LICENSE|integrity\.json|public\/[A-Za-z0-9._/-]+)$/;
const U = (...p) => path.join(config.root, '.update', ...p);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export function currentVersion() {
  if (globalThis.__POS_VERSION__) return globalThis.__POS_VERSION__;
  return readJson(path.join(config.root, 'package.json'))?.version || '0.0.0';
}

function publicKey() {
  const pem = globalThis.__POS_UPDATE_PUBKEY__ || (() => {
    const f = new URL('../security/update-public.pem', import.meta.url);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  })();
  if (!pem) throw new HttpError(409, 'This copy has no update key yet (run npm run keygen before building).', 'no_update_key');
  return crypto.createPublicKey(pem);
}

export function cmp(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0), pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

/** Verify a package; returns { manifest, files } or throws with a plain-language reason. */
export function verifyPackage(buffer) {
  let entries;
  try { entries = unzip(buffer); } catch { throw badRequest('This is not a valid update file'); }
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const mBuf = byName.get('manifest.json'), sig = byName.get('manifest.sig');
  if (!mBuf || !sig) throw badRequest('Update file is incomplete (no manifest or signature)');
  let okSig = false;
  try { okSig = crypto.verify(null, mBuf, publicKey(), Buffer.from(sig.toString('utf8').trim(), 'base64')); } catch (e) { if (e instanceof HttpError) throw e; }
  if (!okSig) throw badRequest('Signature check failed: this update was not made by you, or it was changed');
  const manifest = JSON.parse(mBuf.toString('utf8'));
  if (manifest.app !== 'free-ai-pos') throw badRequest('This update is for a different application');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw badRequest('Update has an invalid version');
  if (cmp(manifest.version, currentVersion()) <= 0) throw badRequest(`Version ${manifest.version} is not newer than the installed ${currentVersion()}`);
  if (manifest.minFromVersion && cmp(currentVersion(), manifest.minFromVersion) < 0) throw badRequest(`Install ${manifest.minFromVersion} first`);
  const files = [];
  for (const [name, hash] of Object.entries(manifest.files || {})) {
    if (!ALLOWED.test(name) || name.includes('..')) throw badRequest(`Update contains a file it may not install: ${name}`);
    const data = byName.get(`files/${name}`);
    if (!data) throw badRequest(`Update is missing ${name}`);
    if (crypto.createHash('sha256').update(data).digest('hex') !== hash) throw badRequest(`${name} does not match its signed fingerprint`);
    files.push({ name, data });
  }
  for (const e of entries) if (e.name.startsWith('files/') && !(e.name.slice(6) in manifest.files)) throw badRequest(`Update contains an unsigned file: ${e.name.slice(6)}`);
  if (!files.some((f) => f.name === 'server.mjs')) throw badRequest('Update does not contain the application');
  return { manifest, files };
}

export function stageUpdate(buffer) {
  if (!BUNDLED) throw new HttpError(409, 'Updates install into the released app (dist). This is a source checkout.', 'not_installed_copy');
  const { manifest, files } = verifyPackage(buffer);
  const dir = U('staged', manifest.version);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of files) {
    const target = path.join(dir, f.name);
    if (!target.startsWith(dir + path.sep)) throw badRequest('Bad path in update');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
  }
  createBackup('pre-update');
  fs.writeFileSync(U('pending.json'), JSON.stringify({ version: manifest.version, stagedAt: new Date().toISOString() }));
  appendLedger('update.staged', manifest.version, { from: currentVersion(), files: files.length, notes: String(manifest.notes || '').slice(0, 500) });
  notify({ type: 'update.ready', level: 'info', title: `Update ${manifest.version} ready`, body: 'Restart to install. Your data was backed up first.' });
  return { staged: true, version: manifest.version, notes: manifest.notes || '' };
}

export function updateStatus() {
  const versionsDir = U('versions');
  return {
    version: currentVersion(),
    installedCopy: BUNDLED,
    launcher: process.env.POS_LAUNCHER === '1',
    pending: readJson(U('pending.json')),
    lastChange: readJson(U('last-change.json')),
    probation: readJson(U('probation.json')),
    rollbackTo: fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir).sort((a, b) => cmp(b, a)) : [],
    hasKey: (() => { try { publicKey(); return true; } catch { return false; } })(),
  };
}

export function requestRollback(to) {
  if (!BUNDLED) throw new HttpError(409, 'Rollback applies to the released app (dist).', 'not_installed_copy');
  if (!/^\d+\.\d+\.\d+$/.test(String(to)) || !fs.existsSync(U('versions', to))) throw badRequest('That version is not available to roll back to');
  createBackup('pre-rollback');
  fs.writeFileSync(U('rollback-request.json'), JSON.stringify({ to }));
  appendLedger('update.rollback_requested', to, { from: currentVersion() });
  return { requested: true, to };
}

/** Ask the launcher to restart us (applies staged restore/update/rollback). */
export function restart() {
  if (process.env.POS_LAUNCHER !== '1') throw new HttpError(409, 'Started without the launcher — close the POS and start it again to finish.', 'no_launcher');
  setTimeout(() => process.exit(75), 400);
  return { restarting: true };
}
