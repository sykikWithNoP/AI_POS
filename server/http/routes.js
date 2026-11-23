// HTTP layer: parse input, call a service, return JSON. No business logic lives here.
import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { HttpError, badRequest, safeEqual, hmacHex, randomToken } from '../lib.js';
import { requireAuth, login, logout, authState, setup, elevate, changePin, dropElevation, csrfOnly } from './auth.js';
import { append as appendLedger, verify as verifyLedger, recent as ledgerRecent } from '../security/ledger.js';
import { toCsv, parseCsv } from './csv.js';
import { sseHandler, listNotifications, markAllRead } from '../bus.js';
import * as settings from '../services/settings.js';
import * as items from '../services/items.js';
import * as sales from '../services/sales.js';
import * as payments from '../services/payments.js';
import * as overview from '../services/overview.js';
import * as apikeys from '../services/apikeys.js';
import * as hooks from '../services/webhooksOut.js';
import * as exts from '../services/extensions.js';
import * as ai from '../services/ai.js';
import * as ird from '../services/ird.js';
import * as customers from '../services/customers.js';
import * as memberships from '../services/memberships.js';
import * as shifts from '../services/shifts.js';
import * as refunds from '../services/refunds.js';
import * as themes from '../services/themes.js';
import * as calendar from '../services/calendar.js';
import * as stripe from '../providers/stripe.js';
import { sendTelegram } from '../notifiers.js';
import { toMajor } from '../../shared/billing.js';
import { checkCode } from '../security/integrity.js';
import { config } from '../config.js';

export const baseUrl = (req) => (settings.getGroup('business').publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

export function apiRouter() {
  const r = Router();
  const owner = requireAuth();
  const scoped = requireAuth({ scope: true });
  const audit = (kind, ref, payload) => appendLedger(kind, ref, payload);
  // Every protected action that succeeds is written to the signed ledger.
  const audited = (guard) => (req, res, next) => {
    guard(req, res, () => {
      res.on('finish', () => { if (res.statusCode < 300) audit('protected.action', `${req.method} ${req.baseUrl}${req.path}`, { by: req.who?.kind }); });
      next();
    });
  };
  const pin = audited(requireAuth({ elevated: true }));                       // owner + PIN re-entered
  const pinOrKey = audited(requireAuth({ scope: true, elevatedOwner: true })); // owner + PIN, or write-scoped API key
  const local = csrfOnly;

  // ---------- auth & bootstrap ----------
  r.get('/auth/state', (req, res) => res.json(authState(req)));
  r.post('/auth/login', local, (req, res) => res.json(login(req, res, req.body?.pin)));
  r.post('/auth/logout', (req, res) => { logout(req, res); res.json({ ok: true }); });
  r.post('/auth/setup', local, (req, res) => res.json(setup(req, res, req.body?.pin)));
  r.post('/auth/elevate', owner, (req, res) => res.json(elevate(req, res, req.body?.pin)));
  r.post('/auth/drop', owner, (req, res) => { dropElevation(req); res.json({ ok: true }); });
  r.post('/auth/pin', owner, (req, res) => res.json(changePin(req, res, req.body || {})));

  r.get('/bootstrap', owner, (req, res) => res.json({
    settings: settings.publicSettings(),
    methods: payments.availableMethods(),
    categories: items.categories(),
    extensions: exts.verifiedEnabledExtensions().map((e) => ({ id: e.id, name: e.name, code: e.code })),
    google: { connected: calendar.isConnected() },
    plans: memberships.listPlans(),
    customTheme: (() => { const t = settings.getGroup('ui').theme; try { return t.startsWith('custom:') ? themes.getTheme(t.slice(7)) : null; } catch { return null; } })(),
    shift: shifts.currentShift(),
    baseUrl: baseUrl(req),
  }));

  r.get('/events', owner, sseHandler);
  r.get('/notifications', owner, (req, res) => res.json(listNotifications()));
  r.post('/notifications/read', owner, (req, res) => { markAllRead(); res.json({ ok: true }); });

  // ---------- items (API-key accessible) ----------
  r.get('/items', scoped, (req, res) => res.json(items.listItems({ q: req.query.q, category: req.query.category, includeInactive: req.query.all === '1' })));
  r.get('/items/export.csv', owner, (req, res) => {
    const rows = items.listItems({ includeInactive: true });
    res.type('text/csv').attachment('items.csv').send(toCsv(rows, [
      { label: 'sku', get: (i) => i.sku }, { label: 'barcode', get: (i) => i.barcode }, { label: 'name', get: (i) => i.name },
      { label: 'category', get: (i) => i.category }, { label: 'price', get: (i) => toMajor(i.price) }, { label: 'cost', get: (i) => toMajor(i.cost) },
      { label: 'tax_rate', get: (i) => i.tax_rate }, { label: 'stock', get: (i) => i.stock }, { label: 'unit', get: (i) => i.unit },
      { label: 'emoji', get: (i) => i.emoji }, { label: 'active', get: (i) => (i.active ? 1 : 0) },
    ]));
  });
  r.post('/items/import', pin, (req, res) => {
    const rows = typeof req.body?.csv === 'string' ? parseCsv(req.body.csv) : req.body?.rows;
    if (!Array.isArray(rows)) throw badRequest('Send { csv } text or { rows } array');
    res.json(items.importItems(rows.slice(0, 5000)));
  });
  r.get('/items/:id', scoped, (req, res) => res.json(items.getItem(req.params.id)));
  r.post('/items', pinOrKey, (req, res) => res.status(201).json(items.createItem(req.body || {})));
  r.put('/items/:id', pinOrKey, (req, res) => { const it = items.updateItem(req.params.id, req.body || {}); audit('item.updated', it.id, { name: it.name, price: it.price, tax_rate: it.tax_rate }); res.json(it); });
  r.delete('/items/:id', pinOrKey, (req, res) => { const r2 = items.deleteItem(req.params.id); audit('item.deleted', req.params.id, {}); res.json(r2); });
  r.get('/categories', scoped, (req, res) => res.json(items.categories()));

  // ---------- sales ----------
  r.post('/sales/quote', scoped, (req, res) => res.json(sales.quote(req.body || {})));
  r.post('/sales', scoped, (req, res) => res.status(201).json(sales.createSale(req.body || {}, { elevated: req.elevated })));
  r.get('/sales', scoped, (req, res) => res.json(sales.listSales(req.query)));
  r.get('/sales/export.csv', owner, (req, res) => {
    const rows = sales.listSales({ ...req.query, limit: 1000 });
    res.type('text/csv').attachment('sales.csv').send(toCsv(rows, [
      { label: 'invoice_no', get: (s) => s.invoice_no }, { label: 'date', get: (s) => s.created_at }, { label: 'bs_date', get: (s) => s.bs_date },
      { label: 'status', get: (s) => s.status }, { label: 'customer', get: (s) => s.customer_name }, { label: 'pan', get: (s) => s.customer_pan },
      { label: 'subtotal', get: (s) => toMajor(s.subtotal) }, { label: 'discount', get: (s) => toMajor(s.discount) }, { label: 'taxable', get: (s) => toMajor(s.taxable) },
      { label: 'tax', get: (s) => toMajor(s.tax) }, { label: 'total', get: (s) => toMajor(s.total) }, { label: 'method', get: (s) => s.payment_method }, { label: 'ird', get: (s) => s.ird_status },
    ]));
  });
  r.get('/sales/:id', scoped, (req, res) => res.json(sales.getSale(req.params.id)));
  r.post('/sales/:id/void', pin, (req, res) => res.json(sales.voidSale(req.params.id, req.body?.reason)));
  r.post('/sales/:id/ird-sync', owner, async (req, res) => res.json(await ird.syncSale(Number(req.params.id))));

  r.post('/sales/:id/postpone', scoped, (req, res) => res.json(sales.postponeSale(Number(req.params.id), req.body || {})));
  r.get('/outstanding', scoped, (req, res) => res.json(sales.outstanding()));
  r.post('/sales/:id/refunds', pin, (req, res) => res.status(201).json(refunds.createRefund(Number(req.params.id), req.body || {})));

  // ---------- customers & loyalty ----------
  r.get('/customers', scoped, (req, res) => res.json(customers.listCustomers(req.query)));
  r.post('/customers', scoped, (req, res) => res.status(201).json(customers.createCustomer(req.body || {})));
  r.get('/customers/:id', scoped, (req, res) => res.json({ ...customers.getCustomer(req.params.id), history: customers.customerHistory(req.params.id) }));
  r.put('/customers/:id', scoped, (req, res) => res.json(customers.updateCustomer(req.params.id, req.body || {})));
  r.delete('/customers/:id', pin, (req, res) => res.json(customers.deleteCustomer(req.params.id)));
  r.post('/customers/:id/points', pin, (req, res) => {
    const delta = Math.trunc(Number(req.body?.delta));
    if (!delta) throw badRequest('delta must be a non-zero whole number');
    customers.adjustPoints(Number(req.params.id), delta);
    res.json(customers.getCustomer(req.params.id));
  });
  r.post('/customers/:id/membership', pin, (req, res) => {
    // Direct (comp) enrolment by the owner. Paid enrolment goes through a sale line { membershipPlanId }.
    memberships.activate(Number(req.params.id), req.body?.planId, { via: 'comp' });
    res.json(customers.getCustomer(req.params.id));
  });
  r.put('/customers/:id/tier', pin, (req, res) => { memberships.setTier(Number(req.params.id), req.body?.planId); res.json(customers.getCustomer(req.params.id)); });
  r.delete('/customers/:id/membership', pin, (req, res) => { memberships.cancelMembership(req.params.id); res.json(customers.getCustomer(req.params.id)); });

  // ---------- membership plans ----------
  r.get('/membership-plans', scoped, (req, res) => res.json({ plans: memberships.listPlans({ all: req.query.all === '1' }), stats: memberships.planStats() }));
  r.post('/membership-plans', pin, (req, res) => res.status(201).json(memberships.createPlan(req.body || {})));
  r.put('/membership-plans/:id', pin, (req, res) => res.json(memberships.updatePlan(req.params.id, req.body || {})));
  r.delete('/membership-plans/:id', pin, (req, res) => res.json(memberships.deletePlan(req.params.id)));

  // ---------- shifts & cash drawer ----------
  r.get('/shifts/current', owner, (req, res) => { const s = shifts.currentShift(); res.json(s ? { shift: s, report: shifts.report(s.id) } : { shift: null }); });
  r.get('/shifts', owner, (req, res) => res.json(shifts.listShifts(req.query.limit)));
  r.get('/shifts/:id', owner, (req, res) => res.json({ shift: shifts.getShift(req.params.id), report: shifts.report(Number(req.params.id)) }));
  r.post('/shifts/open', owner, (req, res) => res.status(201).json(shifts.openShift(req.body || {})));
  r.post('/shifts/cash', owner, (req, res) => res.json(shifts.cashMovement(req.body || {})));
  r.post('/shifts/close', owner, (req, res) => res.json(shifts.closeShift(req.body || {})));

  // ---------- payments ----------
  r.get('/payment-methods', scoped, (req, res) => res.json(payments.availableMethods()));
  r.post('/sales/:id/payments', scoped, async (req, res) => res.status(201).json(await payments.createPayment(Number(req.params.id), req.body || {}, { baseUrl: baseUrl(req) })));
  r.get('/payments/:id', scoped, (req, res) => res.json(payments.getPayment(req.params.id)));
  r.post('/payments/:id/verify', owner, async (req, res) => res.json(await payments.verifyWithProvider(req.params.id)));
  r.post('/payments/:id/confirm', owner, (req, res) => res.json(payments.confirmManual(req.params.id, req.body?.reference)));
  r.post('/payments/:id/cancel', owner, (req, res) => res.json(payments.cancelPayment(req.params.id)));

  // ---------- overview ----------
  r.get('/overview', scoped, (req, res) => res.json(overview.overview({ period: req.query.period || 'month', offset: Math.max(-400, Math.min(0, Number(req.query.offset) || 0)) })));
  r.get('/overview/day', scoped, (req, res) => res.json(overview.daySummary()));

  // ---------- settings & connectors ----------
  r.get('/settings', owner, (req, res) => res.json(settings.publicSettings()));
  // Appearance is personal, not a business rule: no PIN needed.
  r.put('/settings/ui', owner, (req, res) => {
    const v = req.body?.values || {};
    if (v.theme !== undefined && !themes.isValidTheme(v.theme)) throw badRequest('Unknown theme');
    const theme = String(v.theme ?? '');
    if (theme.startsWith('custom:')) themes.getTheme(theme.slice(7));
    const patch = {};
    if (v.theme !== undefined) patch.theme = v.theme;
    if (v.sound !== undefined) patch.sound = v.sound;
    settings.setGroup('ui', patch);
    res.json(settings.publicGroup('ui'));
  });
  r.get('/themes', owner, (req, res) => res.json({ builtIn: themes.BUILT_IN, custom: themes.listThemes() }));
  r.post('/themes', owner, (req, res) => res.status(201).json(themes.createTheme(req.body || {})));
  r.put('/themes/:id', owner, (req, res) => res.json(themes.updateTheme(req.params.id, req.body || {})));
  r.delete('/themes/:id', owner, (req, res) => {
    if (settings.getGroup('ui').theme === `custom:${Number(req.params.id)}`) settings.setGroup('ui', { theme: 'system' });
    res.json(themes.deleteTheme(req.params.id));
  });
  r.get('/themes/:id/image', owner, (req, res) => {
    const img = themes.getThemeImage(req.params.id);
    res.set({ 'Content-Type': img.type, 'Cache-Control': 'private, max-age=86400' }).send(img.data);
  });
  r.put('/settings/:group', pin, (req, res) => {
    const { group } = req.params;
    if (!(group in settings.DEFAULTS)) throw badRequest('Unknown settings group');
    let values = req.body?.values || {};
    // The PIN itself only changes through /auth/pin (which checks the current PIN).
    if (group === 'security') values = { lockScreen: values.lockScreen, elevateMinutes: values.elevateMinutes };
    settings.setGroup(group, values, { clearSecrets: group === 'security' ? [] : req.body?.clearSecrets || [] });
    res.json(settings.publicGroup(group));
  });

  r.post('/connectors/:name/test', owner, async (req, res) => {
    const n = req.params.name;
    if (n === 'ai') return res.json(await ai.testKey());
    if (n === 'telegram') { await sendTelegram('🔔 Test from your POS — notifications are working.'); return res.json({ ok: true }); }
    if (n === 'ird') {
      const cfg = settings.getGroup('ird');
      const sample = { customer_pan: '', fiscal_year: '2083.084', customer_name: 'Test', invoice_no: 'TEST-1', bs_date: '2083.01.01', total: 11300, taxable: 10000, tax: 1300, exempt: 0 };
      return res.json({ ok: true, preview: { ...ird.billPayload(sample, cfg), password: cfg.password ? '***' : '' }, note: 'Preview of what will be sent. Live tests would create a real bill at IRD, so none is sent.' });
    }
    if (n === 'khalti' || n === 'stripe' || n === 'esewa') {
      const cfg = settings.getGroup(n);
      if (n !== 'esewa' && !cfg.secretKey) throw badRequest('Secret key missing');
      return res.json({ ok: true, note: `${n} is configured${cfg.sandbox ? ' (sandbox)' : ''}. Make a small test sale to verify end-to-end.` });
    }
    if (n === 'genericWebhook') {
      const cfg = settings.getGroup('genericWebhook');
      const body = JSON.stringify({ invoice_no: 'INV-XXXX-00001', amount: 100, reference: 'TXN123', status: 'success' });
      return res.json({ ok: true, url: `${baseUrl(req)}/api/webhooks/generic`, exampleBody: body, signature: cfg.secret ? hmacHex(cfg.secret, body) : '(set a secret first)' });
    }
    throw badRequest('Unknown connector');
  });
  r.post('/connectors/genericWebhook/rotate', pin, (req, res) => {
    const secret = `whsec_${randomToken(24)}`;
    settings.setGroup('genericWebhook', { secret });
    res.json({ secret });
  });

  r.get('/keys', owner, (req, res) => res.json(apikeys.listKeys()));
  r.post('/keys', pin, (req, res) => res.status(201).json(apikeys.createKey(req.body || {})));
  r.delete('/keys/:id', pin, (req, res) => res.json(apikeys.revokeKey(req.params.id)));

  r.get('/webhooks-out', owner, (req, res) => res.json({ hooks: hooks.listHooks(), events: hooks.EVENTS }));
  r.post('/webhooks-out', pin, (req, res) => res.status(201).json(hooks.createHook(req.body || {})));
  r.delete('/webhooks-out/:id', pin, (req, res) => res.json(hooks.deleteHook(req.params.id)));

  // ---------- extensions & AI ----------
  r.get('/extensions', owner, (req, res) => res.json(exts.listExtensions()));
  r.post('/extensions', pin, (req, res) => res.status(201).json(exts.createExtension(req.body || {})));
  r.put('/extensions/:id', pin, (req, res) => res.json(exts.updateExtension(req.params.id, req.body || {})));
  r.delete('/extensions/:id', pin, (req, res) => res.json(exts.deleteExtension(req.params.id)));
  r.get('/extensions-api', owner, (req, res) => res.json({ doc: ai.EXTENSION_API_DOC }));
  r.post('/ai/chat', owner, async (req, res) => res.json(await ai.chat(req.body?.messages)));
  r.post('/ai/extension', pin, async (req, res) => res.json(await ai.buildExtension(req.body?.description)));

  // ---------- Google Calendar ----------
  r.get('/google/status', owner, (req, res) => res.json({ connected: calendar.isConnected(), redirectUri: calendar.redirectUri(baseUrl(req)) }));
  r.get('/google/connect', pin, (req, res) => res.redirect(calendar.authUrl(baseUrl(req))));
  r.get('/google/callback', owner, async (req, res) => {
    if (req.query.error) return res.redirect('/#/connectors?google=denied');
    await calendar.handleCallback(baseUrl(req), req.query);
    res.redirect('/#/connectors?google=connected');
  });
  r.post('/google/disconnect', pin, (req, res) => { calendar.disconnect(); res.json({ ok: true }); });
  r.get('/google/events', owner, async (req, res) => res.json(await calendar.upcoming(Number(req.query.days) || 14)));
  r.post('/google/events', owner, async (req, res) => res.status(201).json(await calendar.createEvent(req.body || {})));
  r.post('/google/day-summary', owner, async (req, res) => {
    const d = overview.daySummary();
    const sym = settings.getGroup('business').currencySymbol;
    const money = (v) => `${sym} ${toMajor(v).toFixed(2)}`;
    res.status(201).json(await calendar.createEvent({
      summary: `Day close · ${money(d.revenue)} (${d.bills} bills)`,
      description: `Revenue: ${money(d.revenue)}\nTax: ${money(d.tax)}\n${d.methods.map((m) => `${m.method}: ${money(m.amount)}`).join('\n')}`,
      start: d.date, allDay: true,
    }));
  });

  // ---------- integrity & audit ----------
  r.get('/integrity', owner, (req, res) => {
    const data = verifyLedger();
    const code = checkCode(config.root, config.codeDirs);
    res.json({ ...data, ok: data.ok && code.ok, code: { sealed: code.sealed, ok: code.ok, changed: code.changed.length + code.added.length + code.missing.length },
      problems: [...data.problems, ...(code.ok ? [] : [{ kind: 'code', ref: '', reason: `${code.changed.length + code.added.length + code.missing.length} application file(s) differ from the sealed release` }])] });
  });
  r.get('/audit', owner, (req, res) => res.json(ledgerRecent({ limit: req.query.limit, kind: req.query.kind })));

  // ---------- utilities ----------
  r.get('/qr.svg', owner, async (req, res) => {
    const text = String(req.query.text || '');
    if (!text || text.length > 1500) throw badRequest('text required (max 1500 chars)');
    res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
  });
  r.get('/backup.db', pin, (req, res) => {
    const file = path.join(os.tmpdir(), `pos-backup-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    res.download(file, `pos-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(file, { force: true }, () => {}));
  });

  return r;
}

/** Inbound webhooks: public, authenticated by signature only. */
export function webhookRouter() {
  const r = Router();
  r.post('/generic', (req, res) => {
    const cfg = settings.getGroup('genericWebhook');
    if (!cfg.enabled || !cfg.secret) throw new HttpError(404, 'Generic webhook disabled');
    const sig = String(req.headers['x-pos-signature'] || '');
    if (!safeEqual(sig, hmacHex(cfg.secret, req.rawBody || ''))) throw new HttpError(401, 'Bad signature', 'bad_signature');
    res.json(payments.handleGenericWebhook(req.body || {}));
  });
  r.post('/stripe', (req, res) => {
    const cfg = settings.getGroup('stripe');
    if (!stripe.verifyWebhook(cfg.webhookSecret, req.rawBody || '', req.headers['stripe-signature'])) throw new HttpError(401, 'Bad signature', 'bad_signature');
    const evt = req.body;
    if (evt?.type === 'checkout.session.completed' && evt.data?.object?.payment_status === 'paid') {
      const pid = Number(evt.data.object.metadata?.payment_id);
      if (pid) payments.markVerified(pid, { reference: evt.data.object.payment_intent, detail: { via: 'stripe-webhook' } });
    }
    res.json({ received: true });
  });
  return r;
}
