# Installers — Free AI POS 1.2.0

> Personal use only. Commercial use without the copyright holder's written approval is forbidden — see [LICENSE](../LICENSE).

Pick the one for your computer, click it, then click **Download** (the ⤓ button). The plain-language steps are in the [user guide](../USER-GUIDE.md#3-installing-one-time).

| Computer | File | Size |
|---|---|---|
| Windows 10 / 11 (64-bit) | [FreeAIPOS-1.2.0-Windows-Setup.exe](FreeAIPOS-1.2.0-Windows-Setup.exe) | 22 MB |
| Mac with Apple chip (M1–M4) | [FreeAIPOS-1.2.0-macOS-AppleSilicon.dmg](FreeAIPOS-1.2.0-macOS-AppleSilicon.dmg) | 38 MB |
| Mac with Intel processor | [FreeAIPOS-1.2.0-macOS-Intel.dmg](FreeAIPOS-1.2.0-macOS-Intel.dmg) | 39 MB |

Nothing else needs to be installed. Each package includes the official Node.js 22.23.5 runtime (its licence is included) and the protected release build of the POS.

## What the installers do

**Windows:** installs for the current user only (no administrator rights) into `%LOCALAPPDATA%\Programs\Free AI POS`, adds Start-menu and (optional) desktop shortcuts, optionally starts with Windows, and registers an uninstaller under *Settings › Apps*. Data lives in `%LOCALAPPDATA%\FreeAIPOS\data`; uninstalling asks before deleting it.

**Mac:** a normal app to drag into Applications. Data lives in `~/Library/Application Support/Free AI POS`.

Both open the POS in its own window (Edge or Chrome in app mode, otherwise your default browser) at http://localhost:4321. The POS only answers on this computer.

## "Unknown publisher" warnings

These packages are not code-signed with a paid Apple/Microsoft certificate, so the first start shows a warning:

- **Windows SmartScreen** — *More info › Run anyway*.
- **macOS Gatekeeper** — *System Settings › Privacy & Security › Open Anyway* (macOS 15+) or right-click › *Open* (older).

Check that a download is genuine by comparing its SHA-256 with the list below (`certutil -hashfile <file> SHA256` on Windows, `shasum -a 256 <file>` on Mac).

## SHA-256

```
5a3ad01ad11bdba88047a890ee8fbcf3f0980ebb352e8731ee97e43f04b15aa1 FreeAIPOS-1.2.0-Windows-Setup.exe
c1e25cd3937f2d22e29aa5314f2b2b84e2ed3da581d88d809bbc5713f85d3179 FreeAIPOS-1.2.0-macOS-AppleSilicon.dmg
f836bf479df83d93cd31751b5aed8e9619dcab1f7a180ea6822755739d69ce8e FreeAIPOS-1.2.0-macOS-Intel.dmg
```

## Rebuilding (maintainers)

```bash
npm run keygen     # once: your update-signing key, so installed copies accept your signed updates
npm run build
npm run package    # needs makensis (NSIS), xorriso, tar and python3; downloads Node.js from nodejs.org
```
