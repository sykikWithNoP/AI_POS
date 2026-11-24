# NINDITO POS

> **Licence: personal use only. Commercial use without the copyright holder's written approval is forbidden.** See [LICENSE](LICENSE).

A self-hosted point-of-sale system for a shop owner's own PC. It runs on localhost, needs no build step and no cloud account, and works with keys you supply yourself (BYOK) for payments, IRD, Google Calendar, Telegram and AI.

Everything it needs except Node.js is already in this repository (the runtime modules are committed), so there is nothing to `npm install`. Install **Node.js 22.5+**, then:

- **Windows:** double-click `install.bat`, then `start.bat`
- **macOS / Linux:** `./install.sh`, then `./start.sh`
- **Any OS:** `npm start`

Full requirements and options: [INSTALL.md](INSTALL.md).

Then open http://localhost:4321. The first-run screen creates the **till PIN** and the **owner account** (username, password and a generated **Owner Key** — save it). `npm start` runs the POS through a small launcher that restarts it when a restore or update needs it. Data lives in `./data` (SQLite + the key that encrypts your saved secrets and signs the ledger).

Requires Node.js 22.5 or newer (it uses the built-in `node:sqlite`, so there are no native modules to compile).

## What's in it

**Dashboard with four sections:** POS · Overview · Connectors · Settings (Alt+1…4). On a phone they become a bottom nav bar.

### POS
- **Sell screen**: items grid in the top-left, member/customer search in the top-right above the bill, and an action bar in the bottom-left (★ Membership, Custom item, Discount, Cash drawer).
- **Multiple open bills (sessions)**: tabs above the bill. Click **+ New** to start another bill while one is open, and double-click a tab to rename it (e.g. "Table 4").
- **Instant totals**: the browser and the server use the same billing engine (`shared/billing.js`), working in integer paisa. It handles VAT inclusive/exclusive, exempt items, service charge, line and bill discounts, member pricing, points redemption and extension discount rules.
- **Barcode scanners** (USB/Bluetooth) work anywhere on the sell screen — no need to click the search box — and the camera button scans with a webcam (Chrome/Edge). Shortcuts: F2 search, F3 member search, F9 charge.
- **Variants & add-ons**: option groups per item (e.g. Size: Small −20 / Large +40, Extras: Cheese +30). The server prices every choice itself.
- **Items tab**: add, change and delete items, CSV import/export, cost price, per-item tax, tile colour/emoji, **Stock in** (goods received with supplier, bill no. and cost), **Adjust** (counted stock with a reason, needs the PIN) and a full **stock history** (opening, received, sold, returned, voided, adjusted).
- **Receipts**: browser print in 80/58 mm, or straight to an ESC/POS receipt printer; the cash drawer opens on cash sales.
- **Customers tab**: profiles, visit history, loyalty points and memberships.
- **Checkout**: cash with quick-tender buttons and change, card terminal, Fonepay/bank QR, eSewa, Khalti, Stripe. Split payments are supported.
- **Pay later** (turn on in Settings → Checkout): issues the bill now with a due date. Stock goes out immediately, the payment is collected later, and the bill is tracked as outstanding or overdue.
- **Shifts & cash drawer**: open with a float, record pay-ins and pay-outs, print an X report, then close with a cash count to get the variance and a printed Z report.

### Memberships & loyalty
- **Tiers** (Settings → Memberships): name, member discount %, points multiplier, fee, validity (days, or lifetime), colour and perks.
- Sell a tier with the **★ Membership** button on the POS. It goes onto the bill and **activates when the bill is paid**; renewing the same tier stacks the time.
- Set any customer's tier from a dropdown in Settings, choose a **default tier for new customers**, or comp/cancel a membership from the customer's profile.
- **Loyalty points**: earn per spend (×tier multiplier), redeem at checkout, minimum-redeem rule, manual adjustments. Points are reversed on refunds and voids.

### Payments & verification
- Payment provider webhooks can't reach localhost, so the server **polls** eSewa, Khalti and Stripe for pending payments (every 5 s at first, backing off to 30 s after 10 minutes, expiring after 2 h). The screen updates live over Server-Sent Events, with a chime and a desktop notification.
- **Signed payment-notification webhook** (`POST /api/webhooks/generic`, HMAC-SHA256 in `X-POS-Signature`). Anything can use it to confirm a payment: a bank-SMS forwarder, n8n, Zapier or your own script. The amount is checked against what's due, and retries are deduplicated.
- The Stripe webhook is optional and signature-verified.

### Bills, IRD & refunds
- **Online e-bill** for every sale at `/b/<token>`: printable, with a QR code back to itself, BS date (miti), fiscal year and invoice numbers sequential per fiscal year (`INV-8384-00001`).
- **IRD (CBMS) registration** is optional and starts in **dry-run**. Paid bills (and pay-later bills when issued) are reported to `/api/bill`. Voids and refunds send credit notes to `/api/billreturn`. The CBMS password is never stored in the logged payload.
- **Partial refunds/returns** per line and quantity, via any method. Each one is a credit note: stock comes back and points are reversed.

### Overview
- Strip with **Today / This month / This year** at a glance, then a detailed view of each (with ← → to go back in time). Months and years can be AD or Bikram Sambat (Settings → Business).
- Net revenue after refunds vs the previous period, bills, average bill, VAT, estimated gross profit, pay-later outstanding/overdue, a revenue chart (hour/day/month), payment mix, top items, busy hours, stock alerts, IRD status, Google Calendar events, and a searchable bill list with void, refund, collect, print and copy-link actions. CSV export.

### Reports & IRD (Overview → Reports / IRD)
- **Sales register** in the IRD sales-book layout (miti, bill/credit-note no., buyer, buyer PAN, total, exempt, taxable, VAT), with credit notes and cancelled bills; **VAT summary** month by month for the fiscal year; **profit by item** (using the cost at the time of each sale); **slow-moving stock**; **top customers**; **stock movements**. CSV export and print.
- **IRD made easy:** a readiness checklist and a 3-step setup wizard (business PAN → CBMS login → practice mode or go live). Failed or pending bills **retry automatically** (after 1, 5, 15, 60 minutes, then every few hours), credit notes included, and **Sync everything now** sends the rest.
- **Filing pack**: one ZIP to attach to your return — sales register (CSV + printable HTML), VAT summary, credit notes, and any bills IRD hasn't accepted yet.

### Moving from another system (Settings)
Import **items, customers, opening stock and past sales** from your old POS or spreadsheet (CSV, TSV, semicolon or JSON). Columns are matched automatically (editable), a **dry run** shows exactly what would happen with per-row problems, and the real import runs all-or-nothing. Past sales become signed **history** (`IMP-` numbers): they show in Overview and reports but are never sent to IRD and never use your new invoice numbers; importing the same file twice skips what's already there.

### AI copilot (owner area)
Bring your own Anthropic key. The copilot looks things up by itself (sales, reports, items, customers, bills, IRD status, stock) and **prepares work** — but anything that changes data comes back as a **proposal card you approve or reject**. Attach a **supplier bill photo or PDF** and it drafts the stock-in (creating missing items first); attach an **export from your old system** and it maps the columns, dry-runs the import and proposes it; ask for the **IRD filing pack** and it gives you the download. Approved actions run through the same rules as the screens and are recorded in the ledger. The tool loop runs on your PC; only the conversation and attachments go to the AI service (through the privacy gate).

### Devices (Connectors → Devices)
- **Receipt printer**: network ESC/POS printers on your **local network only** (IP + port 9100), or the computer's printer queue for USB printers (macOS/Linux `lp`, Windows shared printer). Auto-print after each sale, copies, e-bill QR. Test print button.
- **Cash drawer** (through the printer): opens on cash sales; opening it with no sale needs the PIN and is logged.
- **Barcode scanner**: tuning (barcode length, keystroke speed), beep, and a test box.

### Backups & updates (Settings)
- **Automatic backups** on a schedule (default daily, keep 14), plus before every restore and update; download any backup.
- **Restore** from the list or from a file: it is checked first (must be an intact POS database), your current data is kept as a backup, and it's applied on restart.
- **Updates** install from a signed **`.posupdate`** file — nothing is downloaded from the internet. Only packages signed with **your** key are accepted, every file is fingerprint-checked, your data is backed up first, the previous version is kept, a version that fails to start three times is **rolled back automatically**, and you can roll back by hand. The database only ever gains columns, so every older backup and version stays readable.

### Themes
Settings → Appearance has **15 built-in themes**:
- Light: Classic Light, Ocean, Forest, Sunset, Rose, Lavender, Slate, Sand, Arctic, Saffron, High Contrast
- Dark: Classic Dark, Midnight, Mocha, Neon

There's also "Match system", which follows your computer's light/dark setting. Every tile is a live preview, and changing the theme doesn't need the PIN.

**Create from picture:** upload a photo (for example, your shop front). The POS reads its colours, chooses light or dark mode, and picks an accent that passes readability contrast checks. It can also show the photo behind the screens, with a strength slider. You can rebuild the palette from any accent colour or fine-tune all 13 colours, with a live contrast check. Pictures are resized and re-encoded on your PC, which strips metadata such as GPS location. The server re-checks each picture's real file type and size, and accepts colours only as hex values.

### Connectors (bring your own keys)
eSewa · Khalti · Stripe · Fonepay/Bank QR · Card terminal · Payment notification webhook · IRD CBMS · Google Calendar (your own OAuth client; day-close summaries, optional event per sale) · AI Copilot (your Anthropic key) · Telegram alerts · **POS API keys** (scoped read/write Bearer tokens for your own apps) · **Outbound webhooks** (HMAC-signed events to your URLs).

### Build your own features
**Settings → Extensions** runs small JavaScript plugins, sandboxed (see below), with a documented `pos` API: discount rules, toolbar buttons, checkout checks, custom items, and reactions to sales and payments. You can also describe a feature in plain words and the AI Copilot drafts the extension (using your Anthropic key). The draft opens **disabled** so you can read it first.

> **Not technical?** Download the installer for [Windows or Mac](installers/README.md) and read the [plain-language user guide](USER-GUIDE.md).

## Navigation map

Every screen has its own address, `#/<page>/<section>`, so bookmarks and the browser's back/forward buttons work. The sidebar holds the four pages; each page has the same header with its sections as tabs. Owner pages ask for the owner sign-in first.

| Page | Sections |
|---|---|
| **POS** `Alt+1` | Sell · Items · Customers |
| **Overview** `Alt+2` (owner) | Dashboard · Bills · Reports · IRD |
| **Connectors** `Alt+3` (owner) | Payments · Tax & IRD · Apps & AI · Devices · Developer |
| **Settings** `Alt+4` (owner) | Business · Appearance · Checkout · Memberships · Security · Extensions · Data · Updates |

`Alt+[` / `Alt+]` step through sections; arrow keys move between focused tabs. Each page remembers the last section you opened.

## Architecture (one-way)

```
browser ──HTTP──▶ server/http (routes, pages)   thin: parse input, call a service
                      │
                      ▼
               server/services/*               business rules, transactions
                      │            ╲
                      ▼             ╲ emit()
               SQLite (node:sqlite)  ▼
               server/providers/*   server/bus.js ──▶ SSE to browser · notifications
               (eSewa, Khalti, Stripe)            ──▶ IRD sync · Telegram · webhooks · Calendar
```

- Requests flow down; events flow out. Subscribers react to events but never call back into the event that triggered them.
- `server/security/` holds the ledger, the prompt/code guard and the code-integrity check; `server/http/auth.js` is the access layer.
- Frontend: `action → api.js → store (reducer) → render`. Views never mutate state; live server events come in through `live.js`.
- Money is integer minor units everywhere. The server always re-prices catalog items, so a tampered client can't change prices.

## Security & anti-tamper

**Local only.** The server always binds to `127.0.0.1`. There is no LAN mode. Every request must come from this computer *and* name `localhost`/`127.0.0.1`. If you run a tunnel for e-bills and payment webhooks, the tunnel's domain reaches only `/b/…`, `/pay/…` and `/api/webhooks/…`, never the dashboard or API.

**Owner sign-in for Overview, Settings and Connectors.** These areas (and reports, the AI copilot, keys, backups and updates) need **username + password + Owner Key**. The password and key are stored only as scrypt hashes; the owner area signs out after 30 idle minutes; five failures lock it with growing delays, and the error never says which part was wrong. Recovery: reset the password with the Owner Key + PIN; replace the Owner Key with the password + PIN; lost both → run `npm run reset-owner` (or `node server.mjs --reset-owner`) **on the PC itself**, which keeps all data.

**Till PIN** (no staff logins). Selling never asks for it. At the till it approves: changing or deleting items, stock adjustments, voids and refunds, customer points, opening the drawer with no sale, and discounts above the limit you set (Settings → Checkout). Five wrong PINs lock it out with growing delays, and every attempt is logged. API keys can never perform protected actions. The PIN can be changed but not removed.

**Optional: PIN at every start** (Settings → Security). Seals the master key with the PIN and the Owner Key; after every restart the POS stays locked until one of them is entered, so a copied `data` folder reveals nothing.

**Rules enforced on the server, not the screen.** The server re-prices every catalog item, recomputes every total, and checks the discount limit. Nothing done in the browser, the console or an extension can change what a bill charges.

**Rules enforced by the database.** SQLite triggers refuse:
- edits to an issued bill's numbers, amounts or lines
- deleting bills, payments or refunds
- changing a settled payment
- reopening a paid or voided bill
- editing a closed shift or its cash movements

**Signed ledger (tamper evidence).** Every bill, payment, refund, cash movement, settings change and protected action is chained with an HMAC key derived from `data/secret.key`. At startup, and in Settings → Integrity & audit log, the POS re-verifies the chain and compares every bill and refund with its signed copy. Anything changed outside the app (for example by editing the database file with the triggers dropped) shows a red tamper banner.

**Extension sandbox.** Extensions run in an `<iframe sandbox="allow-scripts">` with an opaque origin and a CSP that forbids every network request. They have no cookies, no storage, no access to the page, settings or keys, and they can read only items, customers, sales and overview. Code is scanned before saving: network, `eval`/`Function`, prototype tricks, globals and protected API paths are rejected. An extension edited directly in the database stops loading, because its hash no longer matches the ledger.

**AI prompt layer.** Copilot and feature-builder requests are screened. Attempts to extract keys, PINs, the system prompt or source code, to reverse-engineer the app, to jailbreak, or to bypass tax, IRD, PIN or ledger rules are refused and logged. The model runs under a fixed policy, shop data is passed as untrusted `<shop_data>`, and any configured secret or key-shaped string is scrubbed from replies. Generated extension code goes through the same scanner.

**Privacy: nothing about this PC leaves it.**
- **One outbound gate.** All internet traffic from the server goes through a single egress gate. It only reaches services you have switched on, uses HTTPS, refuses redirects, and has an **Offline mode** switch that blocks everything.
- **No fingerprint.** The gate strips identifying headers: the AI library's OS, CPU, runtime and version headers, the runtime User-Agent, Referer and forwarding headers. Requests carry only a generic User-Agent.
- **Key pinning.** Each saved key can only travel to its own provider: Anthropic key → `api.anthropic.com`, Stripe → `api.stripe.com`, and so on. A key headed to any other host, or a POS API key leaving at all, is blocked and recorded in the signed ledger.
- **No third-party loads in the browser.** CSP `connect-src 'self'` and `img-src 'self' data: blob:` mean the browser loads nothing from other sites. Logos and QR pictures are uploaded and stored locally; external image links are refused. `Referrer-Policy: no-referrer` stops local URLs leaking through links.
- **You can see it.** Settings → Privacy lists each allowed destination, what is sent there, and every outbound connection since start (destination and purpose, never content).
- **What it can't hide.** Any service you connect to necessarily sees your internet IP address. In the browser, Google sign-in and the eSewa payment page see what any website sees. Use a VPN if that matters.

**Hardening.** The strict Content-Security-Policy uses nonces for the few inline scripts. Other protections:
- `X-Robots-Tag`/meta `noindex, noai`
- no source maps
- a console warning against paste-scams and automated agents
- provider secrets encrypted at rest (AES-256-GCM)
- API keys stored only as hashes

### Release build (what you ship)

```bash
npm run build
```

This writes `dist/`: a single minified server bundle (`server.mjs`, all dependencies included), the launcher, a minified UI, no source maps, a proprietary notice, and a sealed `integrity.json`. Copy only the `dist` folder to the shop PC and start it with `npm start` inside it (Node 22.5+). If any shipped file is modified, the release refuses to start (exit code 78). During development, `npm run seal` records the current files and `POS_STRICT_INTEGRITY=1` turns on the same check.

**Shipping updates (once):** run `npm run keygen`. It creates your private signing key at `~/.nindito-pos/update-signing.pem` (back it up offline, never commit it) and writes the public key to `server/security/update-public.pem` (commit this; it's built into every release).

**Each new version:** raise `version` in `package.json`, then `npm run build`. Besides `dist/`, it writes `updates/nindito-pos-<version>.posupdate`, signed with your key (optionally with `POS_RELEASE_NOTES="…"`). Install it on the shop PC from Settings → Updates.

**What this cannot do:** someone with administrator access to the PC can still read and change anything on it; minified JavaScript can still be studied with enough effort. The protections above make every rule server-enforced, make tampering visible, and make extraction unrewarding. Keep the source repository private, and use full-disk encryption plus a PC login password for the strongest setup.

## Tests

```bash
npm test
```

The tests cover the billing maths, BS dates/fiscal years, item CRUD, CSRF, server-side pricing, split payments, webhook signatures and idempotency, API-key scopes, secret masking, e-bills, IRD dry-run, memberships, loyalty, refunds, shifts, pay-later, stock movements, variants, reports, the IRD retry queue and filing pack, backups/restore, update signing and rollback, receipt printing, migration and the AI agent's approval flow (with a stand-in model). Security tests cover local-only access, owner sign-in and recovery, PIN step-up and lockout, the discount limit, database triggers, ledger tamper detection, the sealed key, the AI prompt guard, the extension scanner and the sandbox CSP.

## Notes & limits
- The IRD CBMS field mapping follows the published CBMS JSON format. Keep **dry-run on** until you've confirmed it with IRD for your PAN.
- eSewa/Khalti/Stripe flows follow each provider's documented API but haven't been exercised against live accounts here. Run a small sandbox sale end to end before going live.
- Receipt printing was tested against a simulated network printer; check your printer model with **Test print** (most ESC/POS printers can't print Devanagari, so receipts use plain characters).
- Camera scanning needs a browser with BarcodeDetector (Chrome/Edge).
- Not included by design: staff accounts, gift cards, a Nepali-language interface. Not yet included: multi-location, kitchen display/table maps.
