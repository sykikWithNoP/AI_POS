// Settings are grouped JSON documents. Fields listed in SECRET_FIELDS are encrypted at rest
// and never sent back to the browser in clear text (only a masked hint).
import { db } from '../db.js';
import { encrypt, decrypt } from '../lib.js';
import { append as appendLedger } from '../security/ledger.js';

export const DEFAULTS = {
  business: {
    name: 'My Shop', address: '', phone: '', email: '', pan: '', logoUrl: '',
    currency: 'NPR', currencySymbol: 'Rs.', locale: 'en-IN', invoicePrefix: 'INV',
    receiptFooter: 'Thank you for your purchase!', calendar: 'AD', publicUrl: '',
  },
  tax: { rate: 13, inclusive: false, serviceChargeRate: 0, label: 'VAT' },
  // Owner PIN is mandatory (set on first run). lockScreen also requires it to open the dashboard.
  security: { pinHash: '', lockScreen: false, elevateMinutes: 10, ownerUser: '', ownerPassHash: '', ownerKeyHash: '', ownerIdleMinutes: 30 },
  ui: { theme: 'system', sound: true, compactGrid: false },
  esewa: { enabled: false, sandbox: true, productCode: 'EPAYTEST', secretKey: '' },
  khalti: { enabled: false, sandbox: true, secretKey: '' },
  stripe: { enabled: false, secretKey: '', webhookSecret: '', currency: 'usd', fxRate: 1 },
  qr: { enabled: true, label: 'Fonepay / Bank QR', payload: '', imageUrl: '' },
  card: { enabled: true, label: 'Card terminal' },
  genericWebhook: { enabled: false, secret: '' },
  ird: {
    enabled: false, autoSync: true, dryRun: true,
    billUrl: 'https://cbapi.ird.gov.np/api/bill',
    returnUrl: 'https://cbapi.ird.gov.np/api/billreturn',
    username: '', password: '', sellerPan: '',
  },
  google: { clientId: '', clientSecret: '', refreshToken: '', calendarId: 'primary', logSales: false, dailySummary: true },
  ai: { provider: 'anthropic', apiKey: '', model: 'claude-opus-5-5', effort: 'medium' },
  telegram: { enabled: false, botToken: '', chatId: '', notifyPaid: true },
  // Loyalty: earn `earnPoints` per `earnPer` spent (major units); each point is worth `pointValue` (major units) when redeemed.
  loyalty: { enabled: true, earnPer: 100, earnPoints: 1, pointValue: 1, minRedeem: 50 },
  shifts: { required: false },
  checkout: { allowPostpone: false, postponeRequiresCustomer: true, defaultDueDays: 7, maxDiscountPercent: 20 },
  memberships: { defaultPlanId: 0 },
  privacy: { offline: false },
  backup: { auto: true, everyHours: 24, keep: 14 },
  printer: { mode: 'browser', host: '', port: 9100, queue: '', width: 48, autoPrint: false, openDrawer: true, printQr: true, copies: 1, paper: '80' },
  scanner: { beep: true, minLength: 4, maxGapMs: 35 },
};

export const SECRET_FIELDS = {
  esewa: ['secretKey'],
  khalti: ['secretKey'],
  stripe: ['secretKey', 'webhookSecret'],
  genericWebhook: ['secret'],
  ird: ['password'],
  google: ['clientSecret', 'refreshToken'],
  ai: ['apiKey'],
  telegram: ['botToken'],
  security: ['pinHash', 'ownerPassHash', 'ownerKeyHash'],
};

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const putStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

/** Full group with secrets decrypted. Server-side use only. */
export function getGroup(group) {
  if (!(group in DEFAULTS)) throw new Error(`Unknown settings group ${group}`);
  const row = getStmt.get(group);
  const stored = row ? JSON.parse(row.value) : {};
  const out = { ...DEFAULTS[group], ...stored };
  for (const f of SECRET_FIELDS[group] || []) if (out[f]) out[f] = decrypt(out[f]);
  return out;
}

/** Merge a patch into a group. Empty-string secrets are ignored unless clearSecrets lists them. */
export function setGroup(group, patch, { clearSecrets = [] } = {}) {
  if (!(group in DEFAULTS)) throw new Error(`Unknown settings group ${group}`);
  const current = getGroup(group);
  const allowed = Object.keys(DEFAULTS[group]);
  const secrets = SECRET_FIELDS[group] || [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!allowed.includes(k)) continue; // mass-assignment guard
    if (secrets.includes(k) && (v === '' || v === null || v === undefined || String(v).startsWith('••'))) continue;
    current[k] = coerce(DEFAULTS[group][k], v);
  }
  for (const k of clearSecrets) if (secrets.includes(k)) current[k] = '';
  // Audit: which fields changed. Secret values are never written to the ledger, only the field name.
  const before = getGroup(group);
  const changed = Object.keys(current).filter((k) => String(current[k]) !== String(before[k]));
  if (changed.length) appendLedger('settings.changed', group, Object.fromEntries(changed.map((k) => [k, secrets.includes(k) ? '(secret updated)' : current[k]])));
  const toStore = { ...current };
  for (const f of secrets) if (toStore[f]) toStore[f] = encrypt(toStore[f]);
  putStmt.run(group, JSON.stringify(toStore));
  return current;
}

function coerce(def, v) {
  if (typeof def === 'boolean') return v === true || v === 'true' || v === 1 || v === 'on';
  if (typeof def === 'number') { const n = Number(v); return Number.isFinite(n) ? n : def; }
  return v === null || v === undefined ? '' : String(v);
}

// Never reveal any part of a secret to the browser — only whether one is saved.
const mask = (s) => (s ? '••••••••' : '');

/** Group safe to send to the browser. */
export function publicGroup(group) {
  const g = getGroup(group);
  for (const f of SECRET_FIELDS[group] || []) {
    g[`${f}Set`] = !!g[f];
    g[f] = group === 'security' ? '' : mask(g[f]);
  }
  return g;
}

export function publicSettings() {
  const out = {};
  for (const g of Object.keys(DEFAULTS)) out[g] = publicGroup(g);
  return out;
}

/** Monotonic per-fiscal-year counter (call inside a transaction). */
export function nextSequence(name) {
  const key = `seq:${name}`;
  const row = getStmt.get(key);
  const n = (row ? Number(row.value) : 0) + 1;
  putStmt.run(key, String(n));
  return n;
}

/** What the till (selling screen) needs — no connector configuration, no owner details. */
export function tillSettings() {
  const b = getGroup('business');
  const sec = getGroup('security');
  return {
    business: { name: b.name, currency: b.currency, currencySymbol: b.currencySymbol, locale: b.locale, calendar: b.calendar, publicUrl: b.publicUrl, logoUrl: b.logoUrl, receiptFooter: b.receiptFooter, language: b.language },
    tax: getGroup('tax'),
    checkout: getGroup('checkout'),
    loyalty: getGroup('loyalty'),
    shifts: getGroup('shifts'),
    memberships: getGroup('memberships'),
    ui: getGroup('ui'),
    ird: { enabled: getGroup('ird').enabled, dryRun: getGroup('ird').dryRun },
    security: { pinHashSet: !!sec.pinHash, lockScreen: sec.lockScreen, ownerExists: !!sec.ownerUser },
    printer: (() => { try { const p = getGroup('printer'); return { mode: p.mode, autoPrint: p.autoPrint, openDrawer: p.openDrawer }; } catch { return {}; } })(),
  };
}
