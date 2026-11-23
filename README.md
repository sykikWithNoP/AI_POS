# Free AI POS

A self-hosted point-of-sale system for a shop owner's own PC. It runs on localhost, needs no build step and no cloud account, and works with keys you supply yourself (BYOK) for payments, IRD, Google Calendar, Telegram and AI.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:4321 and create your owner PIN. Data lives in `./data` (SQLite + the key that encrypts your saved secrets and signs the ledger).

Requires Node.js 22.5 or newer (it uses the built-in `node:sqlite`, so there are no native modules to compile).

## What's in it

**Dashboard with four sections:** POS · Overview · Connectors · Settings (Alt+1…4). On a phone they become a bottom nav bar.

### POS
- **Sell screen**: items grid in the top-left, member/customer search in the top-right above the bill, and an action bar in the bottom-left (★ Membership, Custom item, Discount, Cash drawer).
- **Multiple open bills (sessions)**: tabs above the bill. Click **+ New** to start another bill while one is open, and double-click a tab to rename it (e.g. "Table 4").
- **Instant totals**: the browser and the server use the same billing engine (`shared/billing.js`), working in integer paisa. It handles VAT inclusive/exclusive, exempt items, service charge, line and bill discounts, member pricing, points redemption and extension discount rules.
- **Barcode/SKU scan** into the search box, then Enter. Shortcuts: F2 search, F3 member search, F9 charge.
- **Items tab**: add, change and delete items, plus CSV import/export, stock, cost price, per-item tax and tile colour/emoji.
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

**Owner PIN** (created on first run; there are no staff logins). Selling never asks for it. These always need it re-entered (valid for a few minutes):
- changing prices, items, tax and any other setting, membership tiers, customer tiers or points
- voids and refunds
- API keys, webhooks, extensions, Google connect
- backups
- discounts above the limit you set (Settings → Checkout)

Five wrong PINs lock it out with growing delays, and every attempt is logged. API keys can never perform protected actions. The PIN can be changed but not removed.

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

This writes `dist/`: a single minified server bundle (`server.mjs`, all dependencies included), a minified UI, no source maps, a proprietary notice, and a sealed `integrity.json`. Copy only the `dist` folder to the shop PC and start it with `npm start` inside it (Node 22.5+). If any shipped file is modified, the release refuses to start (exit code 78). During development, `npm run seal` records the current files and `POS_STRICT_INTEGRITY=1` turns on the same check.

**What this cannot do:** someone with administrator access to the PC can still read and change anything on it; minified JavaScript can still be studied with enough effort. The protections above make every rule server-enforced, make tampering visible, and make extraction unrewarding. Keep the source repository private, and use full-disk encryption plus a PC login password for the strongest setup.

## Tests

```bash
npm test
```

The tests cover the billing maths, BS dates/fiscal years, item CRUD, CSRF, server-side pricing, split payments, webhook signatures and idempotency, API-key scopes, secret masking, e-bills, IRD dry-run, memberships, loyalty, refunds, shifts and pay-later. Security tests cover local-only access, PIN step-up and lockout, the discount limit, database triggers, ledger tamper detection, the AI prompt guard, the extension scanner and the sandbox CSP.

## Notes & limits
- The IRD CBMS field mapping follows the published CBMS JSON format. Keep **dry-run on** until you've confirmed it with IRD for your PAN.
- eSewa/Khalti/Stripe flows follow each provider's documented API but haven't been exercised against live accounts here. Run a small sandbox sale end to end before going live.
- Not included by design: staff accounts, gift cards. Not yet included: item variants/modifiers, multi-location, kitchen display/table maps, thermal (ESC/POS) printer drivers.
