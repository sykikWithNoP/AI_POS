# NINDITO POS Mobile

> Personal use only. Commercial use without the copyright holder's written approval is forbidden — see [LICENSE](../LICENSE).

The phone edition of NINDITO POS, for **Android** (iPhone later). It is a separate app with its own version number, and it has the same features as the computer edition, because it runs **the same POS code** inside the phone:

- **No server and no computer needed.** The POS engine runs inside the app; sales, products and customers are stored on the phone only.
- **Same screens and rules**: selling, open bills, pay later, memberships, loyalty, shifts, refunds, reports, IRD, backups, extensions, AI copilot, themes, owner sign-in and PIN, tamper-evident records.
- **Android first.** The `.apk` is built on GitHub by the [Android app workflow](../.github/workflows/android-app.yml) and saved in [`installers/`](../installers/README.md). iPhone and automatic updates come later.

## Install (Android 6 or newer)

1. On the phone, open the repository's [`installers`](../installers/README.md) folder on GitHub and tap **`NINDITOPOS-Mobile-<version>-Android.apk`**, then **Download** (⤓).
2. Open the downloaded file. If Android asks, allow your browser to **install unknown apps**, then tap **Install**.
3. Open **NINDITO POS** from the home screen. Set the PIN and owner account, and the welcome setup takes you from there.

**Updating:** open a newer `.apk` the same way and tap **Install**. It installs over the old one and keeps your data. Back up first, just in case. Automatic updates will come in a later version.

## What is different on a phone

| Feature | Phone edition |
|---|---|
| Receipts | Shown in the app with **Share** (send to WhatsApp, email or a printer app). Direct network/USB receipt printers are computer-only. |
| Backups | **Settings › Data › Save a backup off this phone** opens the share sheet (Google Drive, Files, email). |
| Updates | Install a newer `.apk` over the old one (data stays). Automatic updates come later. |
| Start with computer, customer display window, Google Calendar sign-in | Computer edition only. |
| Online payments, IRD, Telegram, AI | Work the same, through the same privacy gate (key pinning, offline mode). |

## Your data survives uninstalling

Android deletes an app's own storage when the app is uninstalled. So NINDITO POS also keeps an **encrypted copy of all your data in the phone's `Documents/NINDITO POS` folder**. That copy stays on the phone after an uninstall and is updated after every change.

- **Encrypted with your Owner Key** (AES-256-GCM, key locked with scrypt). Other apps, or someone who finds the file, can't read it. The copy switches on the first time the Owner Key is typed (owner setup or sign-in).
- **Reinstalling:** on first start, the app asks *Set up a new shop* or *Restore my data*.
  - On older Android versions it finds the copy by itself.
  - On Android 11 and newer, tap **Restore my data from a file…** and pick the file in *Documents › NINDITO POS*.
  - Then enter your Owner Key.
- **Status:** Settings › Data shows whether the safe copy is on and when it was last saved.
- **Google's automatic cloud backup of app data is turned off**, so your business data never goes to Google unless you send it yourself.
- **Deleting the copy:** delete the `Documents/NINDITO POS` folder in your Files app.

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

**Building the APK.**

1. Create your own signing key once with `scripts/make-android-key.sh`.
2. Add the four `ANDROID_*` secrets it prints under GitHub → Settings → Secrets and variables → Actions.
3. Run **Actions → Android app → Run workflow**. GitHub builds the APK and saves it in `installers/`.

Without the secrets the APK is signed with a throw-away test key. It works, but a later build can't be installed over it: back up, uninstall, install the new one, restore. Keep your key safe, because Android only installs updates signed with the same key.
