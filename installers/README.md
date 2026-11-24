# Installers — NINDITO POS 1.2.0

> Personal use only. Commercial use without the copyright holder's written approval is forbidden — see [LICENSE](../LICENSE).

Pick the one for your computer, click it, then click **Download** (the ⤓ button). The plain-language steps are in the [user guide](../USER-GUIDE.md#3-installing-one-time).

| Computer | File | Size |
|---|---|---|
| Windows 10 / 11 (64-bit) | [NINDITOPOS-1.2.0-Windows-Setup.exe](NINDITOPOS-1.2.0-Windows-Setup.exe) | 22 MB |
| Mac with Apple chip (M1–M4) | [NINDITOPOS-1.2.0-macOS-AppleSilicon.dmg](NINDITOPOS-1.2.0-macOS-AppleSilicon.dmg) | 37 MB |
| Android phone or tablet (Android 6+) | [NINDITOPOS-Mobile-1.1.0-Android.apk](NINDITOPOS-Mobile-1.1.0-Android.apk) — see [mobile/README](../mobile/README.md) | 4 MB |
| Mac with Intel processor | [NINDITOPOS-1.2.0-macOS-Intel.dmg](NINDITOPOS-1.2.0-macOS-Intel.dmg) | 38 MB |

Nothing else needs to be installed. Each package includes the official Node.js 22.23.5 runtime (its licence is included) and the protected release build of the POS.

## What the installers do

**Windows:** installs for the current user only (no administrator rights) into `%LOCALAPPDATA%\Programs\NINDITO POS`, adds Start-menu and (optional) desktop shortcuts, optionally starts with Windows, and registers an uninstaller under *Settings › Apps*. Data lives in `%LOCALAPPDATA%\NINDITOPOS\data`; uninstalling asks before deleting it.

**Mac:** a normal app to drag into Applications. Data lives in `~/Library/Application Support/NINDITO POS`.

Both open the POS in its own window (Edge or Chrome in app mode, otherwise your default browser) at http://localhost:4321. The POS only answers on this computer.

## "Unknown publisher" warnings

These packages are not code-signed with a paid Apple/Microsoft certificate, so the first start shows a warning:

- **Windows SmartScreen** — *More info › Run anyway*.
- **macOS Gatekeeper** — *System Settings › Privacy & Security › Open Anyway* (macOS 15+) or right-click › *Open* (older).

Check that a download is genuine by comparing its SHA-256 with the list below (`certutil -hashfile <file> SHA256` on Windows, `shasum -a 256 <file>` on Mac).

## SHA-256

```
755baf176a806d5ce2e8ce12aa3b1b94f2cb4e22922909d242e3dff0d523db6d NINDITOPOS-1.2.0-Windows-Setup.exe
8e1461718760ae15360aa0469fac6849129f96025df2dd0226e52c4fcf069585 NINDITOPOS-1.2.0-macOS-AppleSilicon.dmg
38238a445b30687cb58d80eb268be1ace393d6b734b3ed5701803af8b9aa1a34 NINDITOPOS-1.2.0-macOS-Intel.dmg
26bd58076a8d498b82b7aa9a4e7f58865034d39df52680f5afd7da0a4b058724 NINDITOPOS-Mobile-1.1.0-Android.apk
```

## Rebuilding (maintainers)

```bash
npm run keygen     # once: your update-signing key, so installed copies accept your signed updates
npm run build
npm run package    # needs makensis (NSIS), xorriso, tar and python3; downloads Node.js from nodejs.org
```
