# Installing NINDITO POS

> Personal use only. Commercial use without the copyright holder's written approval is forbidden — see [LICENSE](LICENSE).

## Easiest: the installers

Windows and Mac users don't need anything on this page: download the installer from [`installers/`](installers/README.md) and double-click it. Node.js is included.

The rest of this page is for Linux, or for running from the source code.

## What you need

| Requirement | Needed? | Notes |
|---|---|---|
| **Node.js 22.5 or newer** | **Required** | The only thing to install. Windows: `winget install OpenJS.NodeJS.LTS` · macOS: `brew install node@22` · Linux: [nodejs.org](https://nodejs.org/en/download) or `nvm install 22` |
| Runtime modules (express, @anthropic-ai/sdk, qrcode, nepali-date-converter) | Included | Already in `node_modules/` in this repository — no `npm install` needed to run |
| esbuild | Only to make release builds | Installed by `install.sh --dev` / `install.bat --dev` (it is a different binary on every OS, so it is not committed) |
| A browser | Required | Chrome, Edge or Firefox. Camera barcode scanning needs Chrome or Edge |
| Receipt printer | Optional | Network ESC/POS printers need nothing extra. USB printers: macOS/Linux use CUPS (`lp`, built into macOS); Windows: share the printer |
| Anthropic API key | Optional | Only for the AI copilot — add it in Connectors |
| Payment / IRD / Google / Telegram accounts | Optional | Added in Connectors when you want them |

No database server, no Docker, no build step: data is stored in a SQLite file in `data/`, using the SQLite built into Node.js.

## Install and start

**Windows**
1. Install Node.js (see above).
2. Double-click `install.bat` (checks everything).
3. Double-click `start.bat` — the POS opens in your browser at http://localhost:4321.

**macOS / Linux**
```bash
./install.sh
```
```bash
./start.sh
```
Then open http://localhost:4321.

Or with npm on any OS: `npm start`.

On first start you create the till PIN and the owner account and save your Owner Key.

## For developers

```bash
./install.sh --dev
```
(Windows: `install.bat --dev`) installs the build/test tools as well. Then:

- `npm test` — run the test suite
- `npm run build` — make the release in `dist/` (and a signed update file once you ran `npm run keygen`)
- `npm run server` — run without the launcher (no auto-restart)

**Changing dependencies:** after `npm install <package>`, run `npm run vendor` and commit `node_modules/`. It re-creates the committed runtime modules from `package-lock.json` and leaves out files that are never loaded (source maps, TypeScript types, docs).
