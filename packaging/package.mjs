// Builds the ready-to-install packages from dist/ (run `npm run build` first):
//   installers/FreeAIPOS-<version>-Windows-Setup.exe       (Windows 10/11, 64-bit)
//   installers/FreeAIPOS-<version>-macOS-AppleSilicon.dmg  (M1/M2/M3/M4 Macs)
//   installers/FreeAIPOS-<version>-macOS-Intel.dmg         (older Intel Macs)
// Each bundles the official Node.js runtime, so nothing else has to be installed.
// Needs (on the build machine): makensis (NSIS), xorriso, tar, python3, internet access to nodejs.org.
//   node packaging/package.mjs            all three
//   node packaging/package.mjs --win      Windows only
//   node packaging/package.mjs --mac      macOS only
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { udzo, readUdzo } from './udzo.mjs';

const NODE = '22.23.5';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const cache = path.join(here, '.cache');
const stage = path.join(here, '.stage');
const outDir = path.join(root, 'installers');
const APP = 'Free AI POS';
const want = process.argv.slice(2);
const doWin = !want.length || want.includes('--win');
const doMac = !want.length || want.includes('--mac');

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();
const say = (m) => console.log(`• ${m}`);

if (!fs.existsSync(path.join(dist, 'server.mjs'))) throw new Error('dist/ is missing — run npm run build first');
const version = JSON.parse(fs.readFileSync(path.join(dist, 'package.json'), 'utf8')).version;
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

async function download(file) {
  const dest = path.join(cache, file);
  const sums = path.join(cache, `SHASUMS256-${NODE}.txt`);
  if (!fs.existsSync(sums)) fs.writeFileSync(sums, Buffer.from(await (await fetch(`https://nodejs.org/dist/v${NODE}/SHASUMS256.txt`)).arrayBuffer()));
  const expected = fs.readFileSync(sums, 'utf8').split('\n').find((l) => l.endsWith(`  ${file}`))?.split(' ')[0];
  if (!expected) throw new Error(`No checksum for ${file}`);
  if (!fs.existsSync(dest)) { say(`downloading ${file}`); fs.writeFileSync(dest, Buffer.from(await (await fetch(`https://nodejs.org/dist/v${NODE}/${file}`)).arrayBuffer())); }
  const got = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  if (got !== expected) { fs.rmSync(dest); throw new Error(`Checksum mismatch for ${file}`); }
  return dest;
}

/** Copy the release (dist) and mark it as an installed copy (data then lives in the user's folder). */
function stageApp(dir, platform) {
  fs.cpSync(dist, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify({ installer: platform, version, node: NODE }, null, 1));
}

async function windows() {
  const zip = await download(`node-v${NODE}-win-x64.zip`);
  const s = path.join(stage, 'win');
  fs.rmSync(s, { recursive: true, force: true });
  fs.mkdirSync(path.join(s, 'node'), { recursive: true });
  const inner = `node-v${NODE}-win-x64`;
  sh('python3', ['-I', '-c', `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1])
for m,t in ((sys.argv[2]+'/node.exe','node.exe'),(sys.argv[2]+'/LICENSE','LICENSE')):
    open(sys.argv[3]+'/'+t,'wb').write(z.read(m))`, zip, inner, path.join(s, 'node')]);
  stageApp(path.join(s, 'app'), 'windows');
  const nsis = path.join(here, 'windows');
  say('building the launcher');
  sh('makensis', ['-V2', `-DOUT=${path.join(s, `${APP}.exe`)}`, `-DVERSION=${version}`, path.join(nsis, 'launcher.nsi')]);
  const out = path.join(outDir, `FreeAIPOS-${version}-Windows-Setup.exe`);
  say('building the Windows installer');
  sh('makensis', ['-V2', `-DOUT=${out}`, `-DVERSION=${version}`, `-DSTAGE=${s}`, path.join(nsis, 'installer.nsi')]);
  return out;
}

const infoPlist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>en</string>
	<key>CFBundleDisplayName</key><string>${APP}</string>
	<key>CFBundleExecutable</key><string>${APP}</string>
	<key>CFBundleIconFile</key><string>icon</string>
	<key>CFBundleIdentifier</key><string>com.freeaipos.app</string>
	<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
	<key>CFBundleName</key><string>${APP}</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>${version}</string>
	<key>CFBundleVersion</key><string>${version}</string>
	<key>LSMinimumSystemVersion</key><string>11.0</string>
	<key>LSUIElement</key><true/>
	<key>NSHumanReadableCopyright</key><string>Personal use only. See LICENSE.</string>
</dict>
</plist>
`;

const MAC_LAUNCHER = `#!/bin/sh
# Starts Free AI POS (bundled Node.js + the app) and opens its window.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
exec "$RES/node" "$RES/app/desktop.mjs" "$@"
`;

const README = (arch) => `Free AI POS ${version} for Mac (${arch})

1. Drag "Free AI POS" onto the Applications folder.
2. Open Applications and double-click "Free AI POS".
   The first time, macOS may say it "cannot verify the developer":
   - macOS 15 or newer: open System Settings > Privacy & Security, scroll down
     and click "Open Anyway" next to Free AI POS, then confirm.
   - macOS 14 or older: right-click (or Control-click) the app, choose Open,
     then click Open.
   You only have to do this once.
3. The till opens in its own window. If no window appears, open
   http://localhost:4321 in your browser.

Your data is kept in: ~/Library/Application Support/Free AI POS
Personal use only - see LICENSE inside the app.
`;

/** Take just the HFS+ volume out of xorriso's hybrid image (single-volume image, like hdiutil -layout NONE). */
function hfsVolume(img) {
  if (img.toString('latin1', 0, 2) !== 'ER') throw new Error('expected an Apple partition map');
  const bs = img.readUInt16BE(2);
  for (let i = 1; i < 16; i++) {
    const o = i * bs;
    if (img.toString('latin1', o, o + 2) !== 'PM') break;
    if (img.toString('latin1', o + 48, o + 57) !== 'Apple_HFS') continue;
    const start = img.readUInt32BE(o + 8) * bs, len = img.readUInt32BE(o + 12) * bs;
    const vol = img.subarray(start, start + len);
    if (vol.toString('latin1', 1024, 1026) !== 'H+') throw new Error('HFS+ volume header not found');
    return vol;
  }
  throw new Error('no Apple_HFS partition');
}

async function mac(arch, label) {
  const tgz = await download(`node-v${NODE}-darwin-${arch}.tar.gz`);
  const s = path.join(stage, `mac-${arch}`);
  fs.rmSync(s, { recursive: true, force: true });
  const vol = path.join(s, 'volume');
  const app = path.join(vol, `${APP}.app`, 'Contents');
  fs.mkdirSync(path.join(app, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Resources'), { recursive: true });
  const inner = `node-v${NODE}-darwin-${arch}`;
  const tmp = path.join(s, 'node');
  fs.mkdirSync(tmp, { recursive: true });
  sh('tar', ['-xzf', tgz, '-C', tmp, `${inner}/bin/node`, `${inner}/LICENSE`]);
  fs.renameSync(path.join(tmp, inner, 'bin', 'node'), path.join(app, 'Resources', 'node'));
  fs.renameSync(path.join(tmp, inner, 'LICENSE'), path.join(app, 'Resources', 'node-LICENSE'));
  fs.chmodSync(path.join(app, 'Resources', 'node'), 0o755);
  stageApp(path.join(app, 'Resources', 'app'), 'macos');
  fs.copyFileSync(path.join(here, 'icons', 'icon.icns'), path.join(app, 'Resources', 'icon.icns'));
  fs.writeFileSync(path.join(app, 'Info.plist'), infoPlist());
  fs.writeFileSync(path.join(app, 'PkgInfo'), 'APPL????');
  fs.writeFileSync(path.join(app, 'MacOS', APP), MAC_LAUNCHER, { mode: 0o755 });
  fs.symlinkSync('/Applications', path.join(vol, 'Applications'));
  fs.writeFileSync(path.join(vol, 'READ ME FIRST.txt'), README(label));

  say(`building the macOS disk image (${label})`);
  const raw = path.join(s, 'raw.img');
  // Hybrid image with an HFS+ filesystem (what macOS mounts) in an Apple partition map.
  sh('xorriso', ['-as', 'mkisofs', '-quiet', '-V', APP, '-hfsplus', '-apm-block-size', '2048', '-R', '-o', raw, vol]);
  const rawBuf = hfsVolume(fs.readFileSync(raw));
  const dmg = udzo(rawBuf, 'disk image (Apple_HFS : 0)');
  if (!readUdzo(dmg).subarray(0, rawBuf.length).equals(rawBuf)) throw new Error('disk image self-check failed');
  const out = path.join(outDir, `FreeAIPOS-${version}-macOS-${label.replace(/\s+/g, '')}.dmg`);
  fs.writeFileSync(out, dmg);
  return out;
}

const made = [];
if (doWin) made.push(await windows());
if (doMac) { made.push(await mac('arm64', 'Apple Silicon')); made.push(await mac('x64', 'Intel')); }
fs.rmSync(stage, { recursive: true, force: true });
for (const f of made) {
  const buf = fs.readFileSync(f);
  console.log(`${path.relative(root, f)}  ${(buf.length / 1048576).toFixed(1)} MB  sha256 ${crypto.createHash('sha256').update(buf).digest('hex')}`);
}
