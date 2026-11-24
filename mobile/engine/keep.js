// Data that survives uninstalling the app.
// Android deletes an app's own storage when it is uninstalled. So, besides that storage, the app keeps
// an encrypted copy of everything in the phone's shared Documents folder (Documents/NINDITO POS/),
// which stays when the app is removed. After a reinstall the app offers to restore it.
//
// The copy is encrypted (AES-256-GCM) with a random data key. That key is itself locked with the owner's
// Owner Key (scrypt), so the file is useless to other apps or anyone who finds it, and restoring needs
// the Owner Key. The app learns the Owner Key only when the owner types it (setup, sign-in, new key).
import { Buffer } from 'buffer';
import { gzipSync, gunzipSync } from 'fflate';
import { gcm } from '@noble/ciphers/aes.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { kvGet, kvSet, onPersist } from './runtime.js';

const FOLDER = 'NINDITO POS';
const MAGIC = 'NINDITO-POS-DATA-1\n';
const SCRYPT = { N: 32768, r: 8, p: 1, dkLen: 32 };
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (u) => Buffer.from(u).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const normKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^OK/, '');

let state = null;          // { k, wrap, file, lastAt, lastError }
let timer = null;
let snapshotFn = null;     // () => { db: Uint8Array, files, dirs }

export const keepStatus = () => ({
  on: !!state?.wrap, folder: `Documents/${FOLDER}`, file: state?.file || null,
  lastAt: state?.lastAt || null, lastError: state?.lastError || null,
});

export async function initKeep(snapshot) {
  snapshotFn = snapshot;
  state = (await kvGet('keep')) || null;
  onPersist(async () => { if (state?.wrap) schedule(); });
}

/** Called when the owner types or receives their Owner Key: (re)locks the data key with it. */
export async function rememberOwnerKey(ownerKey) {
  const norm = normKey(ownerKey);
  if (norm.length < 20) return;
  const k = state?.k ? unb64(state.k) : rnd(32);
  const salt = rnd(16), iv = rnd(12);
  const kek = scrypt(new TextEncoder().encode(norm), salt, SCRYPT);
  const wrap = { salt: b64(salt), iv: b64(iv), ct: b64(gcm(kek, iv).encrypt(k)) };
  state = { ...(state || {}), k: b64(k), wrap, file: state?.file || `data-${Date.now().toString(36)}.nindito` };
  await kvSet('keep', state);
  schedule(500);
}

function schedule(ms = 4000) { clearTimeout(timer); timer = setTimeout(() => writeCopy().catch(() => {}), ms); }

async function ensurePermission() {
  try {
    const p = await Filesystem.checkPermissions();
    if (p.publicStorage !== 'granted') await Filesystem.requestPermissions();
  } catch { /* web or newer Android: not needed */ }
}

/** Encrypt everything and write Documents/NINDITO POS/<file>. */
export async function writeCopy() {
  if (!state?.wrap || !snapshotFn) return;
  const snap = snapshotFn();
  const payload = gzipSync(new TextEncoder().encode(JSON.stringify({
    db: b64(snap.db), dirs: snap.dirs, files: Object.fromEntries(Object.entries(snap.files).map(([p, f]) => [p, { data: b64(f.data), mtime: f.mtime }])),
  })));
  const iv = rnd(12);
  const ct = gcm(unb64(state.k), iv).encrypt(payload);
  const header = { app: 'nindito-pos', v: 1, at: new Date().toISOString(), version: globalThis.__POS_MOBILE_VERSION__, wrap: state.wrap, iv: b64(iv), summary: snap.summary };
  const bytes = Buffer.concat([Buffer.from(MAGIC + JSON.stringify(header) + '\n'), Buffer.from(ct)]);
  try {
    await ensurePermission();
    const tmp = `${FOLDER}/${state.file}.tmp`;
    await Filesystem.writeFile({ path: tmp, data: bytes.toString('base64'), directory: Directory.Documents, recursive: true });
    await Filesystem.rename({ from: tmp, to: `${FOLDER}/${state.file}`, directory: Directory.Documents, toDirectory: Directory.Documents });
    state.lastAt = header.at; state.lastError = null;
  } catch (e) {
    state.lastError = String(e.message || e);
  }
  await kvSet('keep', state);
}

/** Read a copy (file bytes) and show what it holds, without decrypting. */
export function inspect(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.subarray(0, MAGIC.length).toString() !== MAGIC) throw new Error('This is not a NINDITO POS data file');
  const nl = buf.indexOf(10, MAGIC.length);
  const header = JSON.parse(buf.subarray(MAGIC.length, nl).toString());
  return { header, ct: new Uint8Array(buf.subarray(nl + 1)) };
}

/** Unlock a copy with the Owner Key. Returns { db, files, dirs } plus the keep state to continue with. */
export function unlock(bytes, ownerKey) {
  const { header, ct } = inspect(bytes);
  const kek = scrypt(new TextEncoder().encode(normKey(ownerKey)), unb64(header.wrap.salt), SCRYPT);
  let k;
  try { k = gcm(kek, unb64(header.wrap.iv)).decrypt(unb64(header.wrap.ct)); } catch { throw new Error('That Owner Key does not open this file'); }
  const data = JSON.parse(new TextDecoder().decode(gunzipSync(gcm(k, unb64(header.iv)).decrypt(ct))));
  return {
    header,
    db: unb64(data.db), dirs: data.dirs,
    files: Object.fromEntries(Object.entries(data.files).map(([p, f]) => [p, { data: unb64(f.data), mtime: f.mtime }])),
    keep: { k: b64(k), wrap: header.wrap, file: `data-${Date.now().toString(36)}.nindito` },
  };
}

/** Copies the app can see in Documents/NINDITO POS (older Android, or this same install). */
export async function findCopies() {
  try {
    const r = await Filesystem.readdir({ path: FOLDER, directory: Directory.Documents });
    const out = [];
    for (const f of r.files || []) {
      const name = typeof f === 'string' ? f : f.name;
      if (!name.endsWith('.nindito')) continue;
      try {
        const file = await Filesystem.readFile({ path: `${FOLDER}/${name}`, directory: Directory.Documents });
        const bytes = unb64(typeof file.data === 'string' ? file.data : await file.data.text());
        out.push({ name, bytes, header: inspect(bytes).header });
      } catch { /* not readable by this install */ }
    }
    return out.sort((a, b) => b.header.at.localeCompare(a.header.at));
  } catch { return []; }
}

export async function adoptRestored(keep) { state = keep; await kvSet('keep', state); schedule(1500); }
