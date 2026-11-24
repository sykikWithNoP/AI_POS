// Offline, signed updates. An update is a .posupdate file (ZIP) containing the new app files, a manifest
// with every file's SHA-256, and an Ed25519 signature over the manifest. Only packages signed with YOUR
// private key (see `npm run keygen`) are accepted. Nothing is downloaded unless the owner turns on
// update checks and gives the address of their own update file (see checkForUpdate).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, BUNDLED } from '../config.js';
import { badRequest, HttpError } from '../lib.js';
import { unzip } from '../util/zip.js';
import { createBackup } from './backups.js';
import { append as appendLedger } from '../security/ledger.js';
import { notify } from '../bus.js';
import { getGroup, setGroup } from './settings.js';
import { egressFetch } from '../security/egress.js';
import { log } from '../lib.js';

const ALLOWED = /^(server\.mjs|launcher\.mjs|updater\.mjs|desktop\.mjs|package\.json|LICENSE|USER-GUIDE\.md|integrity\.json|public\/[A-Za-z0-9._/-]+)$/;
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
  if (manifest.app !== 'nindito-pos') throw badRequest('This update is for a different application');
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
    downloaded: downloadedUpdate(),
    check: (({ autoCheck, manifestUrl, lastCheckAt, latestVersion, latestNotes }) => ({ autoCheck, manifestUrl, lastCheckAt, latestVersion, latestNotes }))(getGroup('updates')),
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

// ---------- optional update checks (off by default) ----------
// The owner can publish their own signed updates at an HTTPS address (e.g. a raw file in their own
// repository): a small latest.json next to the .posupdate file. When checks are on, the POS fetches
// only that address, once a day, through the egress gate. The download is still signature-checked
// exactly like a file installed by hand, so a hijacked address cannot install anything.
const MAX_UPDATE_BYTES = 80 * 1024 * 1024;
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

export async function checkForUpdate() {
  const cfg = getGroup('updates');
  const manifestUrl = String(cfg.manifestUrl || '').trim();
  if (!/^https:\/\/[^/]+\/.+/.test(manifestUrl)) throw badRequest('Add the HTTPS address of your latest.json first');
  const host = hostOf(manifestUrl);
  const res = await egressFetch(manifestUrl, { headers: { accept: 'application/json' } }, { purpose: 'update-check', extraHosts: [host] });
  if (!res.ok) throw new HttpError(502, `Update address answered ${res.status}`, 'update_check_failed');
  let info; try { info = await res.json(); } catch { throw new HttpError(502, 'Update address did not return valid JSON', 'update_check_failed'); }
  const version = String(info.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new HttpError(502, 'Update info has no valid version', 'update_check_failed');
  setGroup('updates', { lastCheckAt: new Date().toISOString(), latestVersion: version, latestNotes: String(info.notes || '').slice(0, 500) });
  const current = currentVersion();
  if (cmp(version, current) <= 0) return { available: false, current, latest: version };
  const fileUrl = new URL(String(info.file || info.url || ''), manifestUrl).href;
  if (hostOf(fileUrl) !== host || !fileUrl.startsWith('https://')) throw new HttpError(502, 'The update file must be on the same HTTPS address as latest.json', 'update_check_failed');
  const dl = await egressFetch(fileUrl, {}, { purpose: 'update-download', extraHosts: [host] });
  if (!dl.ok) throw new HttpError(502, `Could not download the update (${dl.status})`, 'update_check_failed');
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.length > MAX_UPDATE_BYTES) throw badRequest('Update file is too large');
  const { manifest } = verifyPackage(buf);           // signature + every file hash
  if (manifest.version !== version) throw badRequest('Update file version does not match latest.json');
  fs.mkdirSync(U('downloaded'), { recursive: true });
  for (const f of fs.readdirSync(U('downloaded'))) fs.rmSync(U('downloaded', f), { force: true });
  fs.writeFileSync(U('downloaded', `${version}.posupdate`), buf);
  appendLedger('update.downloaded', version, { from: current, bytes: buf.length });
  notify({ type: 'update.available', level: 'info', title: `Version ${version} is ready to install`, body: 'Settings › Updates → Install. Your data is backed up first.' });
  return { available: true, current, latest: version, notes: info.notes || '', downloaded: true };
}

export function downloadedUpdate() {
  try { const f = fs.readdirSync(U('downloaded')).find((x) => /^\d+\.\d+\.\d+\.posupdate$/.test(x)); return f && cmp(f.replace('.posupdate', ''), currentVersion()) > 0 ? f.replace('.posupdate', '') : null; } catch { return null; }
}

export function installDownloaded() {
  const v = downloadedUpdate();
  if (!v) throw badRequest('No downloaded update to install');
  return stageUpdate(fs.readFileSync(U('downloaded', `${v}.posupdate`)));
}

export function startUpdateChecks() {
  const tick = async () => {
    const cfg = getGroup('updates');
    if (!cfg.autoCheck || !cfg.manifestUrl || !BUNDLED) return;
    if (cfg.lastCheckAt && Date.now() - Date.parse(cfg.lastCheckAt) < 20 * 3600_000) return;
    try { await checkForUpdate(); } catch (e) { log.warn('update check failed', { err: e.message }); }
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, 3 * 3600_000).unref?.();
}
