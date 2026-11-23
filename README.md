# Free AI POS

A self-hosted point-of-sale system for a shop owner's own PC. It runs on localhost, needs no build step and no cloud account, and works with keys you supply yourself (BYOK) for payments, IRD, Google Calendar, Telegram and AI.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:4321. Data lives in `./data` (SQLite + an encryption key for your saved secrets).

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

### Connectors (bring your own keys)
eSewa · Khalti · Stripe · Fonepay/Bank QR · Card terminal · Payment notification webhook · IRD CBMS · Google Calendar (your own OAuth client; day-close summaries, optional event per sale) · AI Copilot (your Anthropic key) · Telegram alerts · **POS API keys** (scoped read/write Bearer tokens for your own apps) · **Outbound webhooks** (HMAC-signed events to your URLs).

### Build your own features
**Settings → Extensions** runs small JavaScript plugins with a documented `pos` API: discount rules, toolbar buttons, checkout checks, custom items, and reactions to sales and payments. You can also describe a feature in plain words and the AI Copilot drafts the extension (using your Anthropic key). The draft opens **disabled** so you can read it first.

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
- Frontend: `action → api.js → store (reducer) → render`. Views never mutate state; live server events come in through `live.js`.
- Money is integer minor units everywhere. The server always re-prices catalog items, so a tampered client can't change prices.

## Security model
- Listens on **127.0.0.1** only by default. With no PIN set, requests from this PC are trusted.
- Set a **PIN** (Settings → Security) to lock the screen. A PIN is required before other devices can connect (`HOST=0.0.0.0 npm start`).
- Browser mutations must carry an `X-POS-Client` header and be same-origin (CSRF guard). The Host header is allow-listed (DNS-rebinding guard).
- **Secrets are never shown again**: provider keys are encrypted at rest (AES-256-GCM, key in `data/secret.key` or `POS_SECRET_KEY`), and the browser only learns whether a key is saved. API keys are stored as SHA-256 hashes and shown once.
- Extensions run with full dashboard privileges. Only enable code you have read.

## Configuration
| Env var | Default | |
|---|---|---|
| `PORT` | `4321` | |
| `HOST` | `127.0.0.1` | set `0.0.0.0` for LAN use (set a PIN first) |
| `DATA_DIR` | `./data` | database + secret key |
| `POS_SECRET_KEY` | — | derive the encryption key from this instead of `data/secret.key` |
| `VERIFY_INTERVAL_MS` | `5000` | payment polling tick |

**Backups**: Settings → Backup downloads a consistent copy of the database. Keep `data/secret.key` too, since it's needed to decrypt saved keys.

## Tests

```bash
npm test
```

The tests cover the billing maths, BS dates/fiscal years, item CRUD, CSRF, server-side pricing, split payments, webhook signatures and idempotency, API-key scopes, secret masking, the PIN lock, e-bills, IRD dry-run, memberships, loyalty, refunds, shifts and pay-later.

## Notes & limits
- The IRD CBMS field mapping follows the published CBMS JSON format. Keep **dry-run on** until you've confirmed it with IRD for your PAN.
- eSewa/Khalti/Stripe flows follow each provider's documented API but haven't been exercised against live accounts here. Run a small sandbox sale end to end before going live.
- Not yet included: staff accounts with roles, item variants/modifiers, gift cards, multi-location, kitchen display/table maps, thermal (ESC/POS) printer drivers.
