// Desktop integration: start the POS when this computer starts, and shut it down cleanly.
// Autostart writes ONE small file in the user's own startup folder (no admin rights, no registry):
//   Windows: Startup folder (.vbs that starts the POS hidden) · macOS: ~/Library/LaunchAgents · Linux: ~/.config/autostart
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, BUNDLED } from '../config.js';
import { HttpError } from '../lib.js';
import { setGroup } from './settings.js';
import { append as appendLedger } from '../security/ledger.js';

const LABEL = 'com.freeaipos.app';

function target() {
  const home = os.homedir();
  const override = process.env.POS_AUTOSTART_DIR; // tests
  if (process.platform === 'win32') return path.join(override || path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), 'Free AI POS.vbs');
  if (process.platform === 'darwin') return path.join(override || path.join(home, 'Library', 'LaunchAgents'), `${LABEL}.plist`);
  return path.join(override || path.join(home, '.config', 'autostart'), 'free-ai-pos.desktop');
}

/** The command that starts the POS in the background (no window). */
function command() {
  const desktop = path.join(config.root, BUNDLED ? 'desktop.mjs' : 'scripts/desktop.mjs');
  return [process.execPath, desktop, '--background'];
}

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function fileContent() {
  const [node, script, flag] = command();
  if (process.platform === 'win32') {
    const q = (s) => `""${String(s).replace(/"/g, '')}""`;
    return `' Starts Free AI POS in the background when you sign in to Windows.\r\nCreateObject("WScript.Shell").Run "${q(node)} ${q(script)} ${flag}", 0, False\r\n`;
  }
  if (process.platform === 'darwin') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string><string>${flag}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`;
  }
  const qq = (s) => `"${String(s).replace(/(["`$\\])/g, '\\$1')}"`;
  return `[Desktop Entry]\nType=Application\nName=Free AI POS\nComment=Start the POS in the background\nExec=${qq(node)} ${qq(script)} ${flag}\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`;
}

export function autostartStatus() {
  const f = target();
  return { enabled: fs.existsSync(f), platform: process.platform, where: path.dirname(f) };
}

export function setAutostart(on) {
  const f = target();
  if (on) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, fileContent(), { mode: 0o644 });
  } else fs.rmSync(f, { force: true });
  setGroup('system', { autostart: !!on });
  appendLedger('system.autostart', on ? 'on' : 'off', {});
  return autostartStatus();
}

/** Stop the POS (and its launcher). The desktop icon starts it again. */
export function shutdown() {
  appendLedger('system.shutdown', 'owner', {});
  if (!process.env.POS_TEST) setTimeout(() => process.exit(0), 400);
  return { stopping: true };
}

export function assertDesktop() {
  if (!process.env.POS_LAUNCHER) throw new HttpError(409, 'Started without the launcher.', 'no_launcher');
}
