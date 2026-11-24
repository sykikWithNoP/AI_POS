# NINDITO POS Mobile

> Personal use only. Commercial use without the copyright holder's written approval is forbidden — see [LICENSE](../LICENSE).

The phone edition of NINDITO POS, for **Android** and **iPhone**. It is a separate app with its own version number, and it has the same features as the computer edition, because it runs **the same POS code** inside the phone:

- **No server and no computer needed.** The POS engine runs inside the app; sales, products and customers are stored on the phone only.
- **Same screens and rules**: selling, open bills, pay later, memberships, loyalty, shifts, refunds, reports, IRD, backups, extensions, AI copilot, themes, owner sign-in and PIN, tamper-evident records.
- **Updates come from GitHub Releases.** Each version is built and published by the [Mobile app workflow](../.github/workflows/mobile-release.yml); the app checks for new versions and offers **Update**.

## Install

Open the latest **NINDITO POS Mobile** release on the repository's [Releases page](https://github.com/sykikWithNoP/AI_POS/releases) **on the phone**.

| Phone | File | How |
|---|---|---|
| Android 6+ | `NINDITOPOS-Mobile-<version>-Android.apk` | Tap it, then **Open**. Allow "install unknown apps" for your browser when asked, then **Install**. |
| iPhone (iOS 14+) | `NINDITOPOS-Mobile-<version>-iPhone-unsigned.ipa` | Apple only allows App Store apps on ordinary iPhones, so this file has to be installed with a sideloading tool such as **AltStore** or **Sideloadly** and your own Apple ID. |

## What is different on a phone

| Feature | Phone edition |
|---|---|
| Receipts | Shown in the app with **Share** (send to WhatsApp, email or a printer app). Direct network/USB receipt printers are computer-only. |
| Backups | **Settings › Data › Save a backup off this phone** opens the share sheet (Google Drive, Files, email). |
| Updates | **Settings › Updates** shows the installed and latest versions; a banner appears when a new one is out. |
| Start with computer, customer display window, Google Calendar sign-in | Computer edition only. |
| Online payments, IRD, Telegram, AI | Work the same, through the same privacy gate (key pinning, offline mode). |

Everything stays inside the app's private storage. Uninstalling the app deletes its data, so save a backup first.

## For maintainers

```bash
cd mobile
npm ci
npm run build          # builds www/: the screens + the in-app engine
npm run serve          # try it in a desktop browser at http://localhost:8790 (no POS server involved)
npx cap sync android   # copy www into the Android project; open android/ in Android Studio to run it
```

**How it works.** `engine/host.js` boots the POS engine inside the WebView. The server code in `../server` is bundled unchanged, with phone stand-ins for Node's built-in modules in `engine/shims/`:

| Stand-in | What it does |
|---|---|
| `node:sqlite` | SQLite compiled to WebAssembly (sql.js) |
| `node:crypto` | The audited @noble libraries: SHA-256, HMAC, scrypt, AES-GCM and Ed25519 |
| `node:fs` | A private in-app file store |
| `express` | An in-memory router |

Requests to `/api` never touch a network. Outbound calls to payment providers and other services go through Capacitor's native HTTP.

**Releasing.**

1. Run `scripts/make-android-key.sh` once to create your signing key.
2. Add the four `ANDROID_*` secrets it prints under GitHub → Settings → Secrets and variables → Actions.
3. Raise `version` in `mobile/package.json` and push to `main`. The workflow builds the APK (signed with your key) and the unsigned IPA, then publishes the release `mobile-v<version>`.

Keep the key safe: Android only installs updates signed with the same key.
