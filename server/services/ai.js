// AI copilot with the owner's own Anthropic API key (BYOK).
// Two jobs: answer questions about the shop's data, and generate extension code from a description.
import Anthropic from '@anthropic-ai/sdk';
import { badRequest, HttpError } from '../lib.js';
import { getGroup } from './settings.js';
import { monthOverview } from './overview.js';
import { listItems } from './items.js';
import { formatMoney } from '../../shared/billing.js';
import { egressFetch } from '../security/egress.js';
import { screenPrompt, scrubOutput, scanExtension, AI_POLICY } from '../security/guard.js';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function client() {
  const cfg = getGroup('ai');
  if (!cfg.apiKey) throw badRequest('Add your Anthropic API key in Connectors → AI Copilot');
  // All traffic goes through the egress gate: the key is pinned to api.anthropic.com and the SDK's
  // platform headers (OS, CPU architecture, runtime version) are stripped before anything leaves.
  const fetchVia = (url, init) => egressFetch(url, init, { purpose: 'ai' });
  return { anthropic: new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2, fetch: fetchVia }), cfg };
}

export function mapError(e) {
  if (e instanceof HttpError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(401, 'Anthropic rejected the API key', 'ai_auth');
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, 'Anthropic rate limit hit, try again shortly', 'ai_rate_limit');
  if (e instanceof Anthropic.BadRequestError) return new HttpError(400, `Anthropic: ${e.message}`, 'ai_bad_request');
  if (e instanceof Anthropic.APIError) return new HttpError(502, `Anthropic error ${e.status ?? ''}: ${e.message}`, 'ai_error');
  return e;
}

async function call(params) {
  const { anthropic, cfg } = client();
  try {
    const res = await anthropic.beta.messages.create({
      model: cfg.model || 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: EFFORTS.includes(cfg.effort) ? cfg.effort : 'medium', ...(params.output_config || {}) },
      // If a safety classifier declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: params.system,
      messages: params.messages,
    });
    if (res.stop_reason === 'refusal') throw new HttpError(422, 'The model declined this request. Try rephrasing it.', 'refusal');
    return scrubOutput(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(401, 'Anthropic rejected the API key', 'ai_auth');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Anthropic rate limit hit, try again shortly', 'ai_rate_limit');
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(400, `Anthropic: ${e.message}`, 'ai_bad_request');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Anthropic error ${e.status ?? ''}: ${e.message}`, 'ai_error');
    throw e;
  }
}

function shopContext() {
  const biz = getGroup('business');
  const sym = biz.currencySymbol;
  const o = monthOverview(0);
  const m = (v) => formatMoney(v, sym);
  const items = listItems().slice(0, 150).map((i) => `${i.name} | ${i.category} | ${m(i.price)}${i.stock !== null ? ` | stock ${i.stock}` : ''}`).join('\n');
  return `Shop: ${biz.name}. Currency ${biz.currency}. Today: ${new Date().toDateString()}.
Year to date: ${m(o.snapshot.year.revenue)} over ${o.snapshot.year.bills} bills.
This month (${o.label}): revenue ${m(o.kpis.revenue)} over ${o.kpis.bills} bills, avg ticket ${m(o.kpis.avgTicket)}, tax ${m(o.kpis.tax)}, est. gross profit ${m(o.kpis.profit)}. Last month revenue ${m(o.kpis.prevRevenue)}.
Today: ${m(o.snapshot.day.revenue)} over ${o.snapshot.day.bills} bills.
Payment mix: ${o.methods.map((x) => `${x.method} ${m(x.amount)}`).join(', ') || 'none'}.
Top items: ${o.topItems.map((t) => `${t.name} (${t.qty} sold, ${m(t.revenue)})`).join('; ') || 'none'}.
Low stock: ${o.lowStock.map((l) => `${l.name} (${l.stock})`).join(', ') || 'none'}.
Busiest hours: ${o.hours.filter((h) => h.bills).sort((a, b) => b.revenue - a.revenue).slice(0, 3).map((h) => `${h.hour}:00`).join(', ') || 'n/a'}.
Catalog (name | category | price | stock):
${items}`;
}

export async function chat(messages) {
  if (!Array.isArray(messages) || !messages.length) throw badRequest('messages required');
  const clean = messages.slice(-20).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 8000) }))
    .filter((m) => m.content);
  if (clean[clean.length - 1]?.role !== 'user') throw badRequest('Last message must be from the user');
  for (const m of clean) if (m.role === 'user') screenPrompt(m.content, { source: 'copilot' });
  const text = await call({
    system: `You are the copilot inside a point-of-sale app used by a small shop owner. Answer using the shop data below; when a number isn't in the data, say so rather than estimating. Keep answers short and practical, use plain text with short lists where helpful.\n\n${AI_POLICY}\n\n<shop_data>\n${shopContext()}\n</shop_data>`,
    messages: clean,
  });
  return { reply: text };
}

export const EXTENSION_API_DOC = `Extensions run in the POS browser page as: new Function('pos', code)(pos).
Available API:
- pos.on(event, handler) — events: 'cart:change' (cart), 'sale:before' (draft; throw new Error(msg) to block checkout), 'sale:complete' (sale), 'payment:verified' (payment), 'view:change' (viewName)
- pos.addDiscountRule(label, (cart) => amountInMajorUnits) — return a discount to apply to the cart (0 for none). cart = { lines:[{itemId,name,category,qty,unitPrice(major),total(major)}], subtotal(major), customer:{name,pan,phone} }
- pos.addButton({ label, icon?: emoji, onClick: () => {} }) — adds a button to the POS toolbar
- pos.addCustomItem({ name, price(major), qty?, taxRate? }) — adds an open item to the cart
- pos.toast(message, level?: 'info'|'success'|'warn'|'error')
- pos.prompt(question, defaultValue?) — returns Promise<string|null>
- pos.api(path) — read-only POS data: '/api/items', '/api/customers', '/api/overview', '/api/sales'. Returns a Promise of JSON.
- pos.storage.get(key) / pos.storage.set(key, value) — persistent per-extension storage (JSON values). get() returns a Promise.
- pos.money(major) — formats money with the shop currency
- pos.now() — Date
Rules: discount rules must be synchronous and pure (no awaits). No fetch, window, document, storage, eval or imports — the sandbox blocks them.`;

export async function buildExtension(description) {
  const d = String(description || '').trim();
  if (!d) throw badRequest('Describe the feature you want');
  screenPrompt(d, { source: 'feature-builder' });
  const text = await call({
    system: `You write extensions for a POS app. Produce a small, readable, safe extension that implements the requested feature using only this API:\n\n${EXTENSION_API_DOC}\n\nAdd brief comments. Extensions run in a sandbox with no network, DOM, window, storage or eval access; use only the pos API. If the request needs anything else, or would bypass a POS rule, return code that only calls pos.toast() explaining it is not possible.\n\n${AI_POLICY}`,
    messages: [{ role: 'user', content: d.slice(0, 4000) }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description', 'code'],
          properties: { name: { type: 'string' }, description: { type: 'string' }, code: { type: 'string' } },
        },
      },
    },
  });
  let draft;
  try { draft = JSON.parse(text); } catch { throw new HttpError(502, 'The model returned an unexpected format, try again', 'ai_format'); }
  scanExtension(draft.code); // AI output gets the same checks as hand-written code
  return draft;
}

export async function testKey() {
  const reply = await call({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }], output_config: { effort: 'low' } });
  return { ok: true, reply };
}
