// Egress gate: the ONLY way this server talks to the internet.
//  - Off by default for everything except the services you switched on (allowlist built from settings).
//  - Offline mode blocks every outbound connection.
//  - HTTPS only (plain HTTP is allowed only to this same computer), no redirects to other hosts.
//  - Identifying headers are removed: no OS/CPU/runtime fingerprint, generic User-Agent, no Referer.
//  - Key pinning: each saved secret may only be sent to its own provider. Any request carrying a secret
//    to a different host — or carrying a POS API key at all — is blocked and logged.
//  - Every outbound request is recorded (host, purpose, status — never the content).
import { getGroup, SECRET_FIELDS } from '../services/settings.js';
import { append as appendLedger } from './ledger.js';
import { notify } from '../bus.js';
import { HttpError } from '../lib.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

/** Which hosts each connector may reach, and which of its secrets belong to those hosts. */
function connectors() {
  const g = (n) => getGroup(n);
  const ird = g('ird');
  return {
    esewa: { on: g('esewa').enabled, hosts: g('esewa').sandbox ? ['rc-epay.esewa.com.np', 'rc.esewa.com.np'] : ['epay.esewa.com.np', 'esewa.com.np'], secrets: ['secretKey'] },
    khalti: { on: g('khalti').enabled, hosts: g('khalti').sandbox ? ['dev.khalti.com'] : ['khalti.com'], secrets: ['secretKey'] },
    stripe: { on: g('stripe').enabled, hosts: ['api.stripe.com'], secrets: ['secretKey', 'webhookSecret'] },
    ird: { on: ird.enabled && !ird.dryRun, hosts: [hostOf(ird.billUrl), hostOf(ird.returnUrl)].filter(Boolean), secrets: ['password'] },
    google: { on: !!(g('google').clientId), hosts: ['oauth2.googleapis.com', 'www.googleapis.com'], secrets: ['clientSecret', 'refreshToken'] },
    ai: { on: !!g('ai').apiKey, hosts: ['api.anthropic.com'], secrets: ['apiKey'] },
    telegram: { on: g('telegram').enabled || !!g('telegram').botToken, hosts: ['api.telegram.org'], secrets: ['botToken'] },
  };
}

export function allowedDestinations() {
  const out = [];
  for (const [name, c] of Object.entries(connectors())) if (c.on) for (const h of c.hosts) out.push({ connector: name, host: h });
  return out;
}

// ---- activity log (in memory: recent 300 requests + per-host totals) ----
const recent = [];
const totals = new Map();
function record(entry) {
  recent.unshift({ ...entry, at: new Date().toISOString() });
  if (recent.length > 300) recent.pop();
  const t = totals.get(entry.host) || { host: entry.host, requests: 0, blocked: 0, last: null };
  t.requests++; if (entry.blocked) t.blocked++; t.last = new Date().toISOString();
  totals.set(entry.host, t);
}
export const egressActivity = () => ({ recent: recent.slice(0, 100), totals: [...totals.values()].sort((a, b) => b.requests - a.requests) });

function block(host, purpose, reason, severe = false) {
  record({ host, purpose, blocked: true, reason });
  if (severe) {
    appendLedger('security.egress_blocked', host, { purpose, reason });
    notify({ type: 'security.egress_blocked', level: 'error', title: 'Blocked an outbound request', body: `${reason} → ${host}`, data: { host } });
  }
  throw new HttpError(403, `Outbound request blocked: ${reason}`, 'egress_blocked');
}

/** Values that must never leave, with the hosts each one is allowed to go to. */
function secretBindings() {
  const conns = connectors();
  const bind = [];
  for (const [group, fields] of Object.entries(SECRET_FIELDS)) {
    if (group === 'security' || group === 'genericWebhook') continue; // never sent anywhere
    const cfg = getGroup(group);
    const owner = conns[group];
    for (const f of fields) {
      const v = cfg[f];
      if (v && String(v).length >= 6) bind.push({ value: String(v), hosts: owner && owner.secrets.includes(f) ? owner.hosts : [], label: `${group}.${f}` });
    }
  }
  const hook = getGroup('genericWebhook').secret;
  if (hook) bind.push({ value: hook, hosts: [], label: 'genericWebhook.secret' });
  return bind;
}

function bodyText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
  return '';
}

const STRIP = /^(x-stainless-|user-agent$|referer$|x-forwarded|forwarded$|via$|x-real-ip$)/i;

/**
 * Drop-in replacement for fetch() for all server-side outbound traffic.
 * `purpose` is a short label for the activity log (e.g. 'khalti', 'webhook').
 * `extraHosts` lets callers allow a specific destination for this call (outbound webhooks you configured).
 */
export async function egressFetch(input, init = {}, { purpose = 'other', extraHosts = [] } = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const host = url.hostname.toLowerCase();
  if (getGroup('privacy').offline) block(host, purpose, 'offline mode is on');
  const local = LOOPBACK.has(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) block(host, purpose, 'only HTTPS is allowed', true);
  const allowed = new Set([...allowedDestinations().map((d) => d.host), ...extraHosts.map((h) => h.toLowerCase())]);
  if (!local && !allowed.has(host)) block(host, purpose, 'destination is not an enabled connector', true);

  // Clean headers: no fingerprinting of this PC.
  const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
  for (const k of [...headers.keys()]) if (STRIP.test(k)) headers.delete(k);
  headers.set('user-agent', 'POS');

  // Key pinning.
  const haystack = `${url.href}\n${[...headers.entries()].map(([k, v]) => `${k}:${v}`).join('\n')}\n${bodyText(init.body)}`;
  for (const s of secretBindings()) {
    if (haystack.includes(s.value) && !s.hosts.includes(host)) block(host, purpose, `${s.label} may not be sent to this host`, true);
  }
  if (/\bpos_[A-Za-z0-9_-]{20,}/.test(haystack)) block(host, purpose, 'POS API keys never leave this computer', true);

  try {
    const res = await fetch(url, { ...init, headers, redirect: 'error', referrerPolicy: 'no-referrer', signal: init.signal || AbortSignal.timeout(20000) });
    record({ host, purpose, status: res.status, method: init.method || 'GET' });
    return res;
  } catch (e) {
    record({ host, purpose, error: e.name === 'TimeoutError' ? 'timeout' : 'network error', method: init.method || 'GET' });
    throw e;
  }
}
