// Event reactions. Each subscriber reacts to a bus event and may call a downstream service;
// none of them feed back into the event that triggered them, so the flow stays one-way.
import { subscribe } from './bus.js';
import { getGroup } from './services/settings.js';
import { dispatch } from './services/webhooksOut.js';
import { syncSale, returnSale, returnRefund } from './services/ird.js';
import * as calendar from './services/calendar.js';
import { formatMoney } from '../shared/billing.js';
import { httpJson, log, badRequest } from './lib.js';

export async function sendTelegram(text, cfg = getGroup('telegram')) {
  if (!cfg.botToken || !cfg.chatId) throw badRequest('Telegram bot token and chat ID are required');
  const r = await httpJson(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.chatId, text }),
  });
  if (!r.ok) throw badRequest(`Telegram: ${r.json?.description || r.status}`);
  return true;
}

export function startNotifiers() {
  subscribe(dispatch);

  subscribe(async ({ type, payload }) => {
    // A postponed bill is still a sale for tax purposes: report it when issued, not when paid.
    if ((type === 'sale.postponed' || (type === 'sale.paid' && !payload.sale.postponed)) && getGroup('ird').enabled && getGroup('ird').autoSync) await syncSale(payload.sale.id);
    if (type === 'sale.void' && payload.wasSynced) await returnSale(payload.sale.id);
    if (type === 'refund.created') await returnRefund(payload.refund.id);
  });

  subscribe(async ({ type, payload }) => {
    if (type !== 'sale.paid') return;
    const t = getGroup('telegram');
    if (!t.enabled || !t.notifyPaid) return;
    const sym = getGroup('business').currencySymbol;
    const s = payload.sale;
    await sendTelegram(`✅ ${getGroup('business').name}: ${s.invoice_no} paid ${formatMoney(s.total, sym)} via ${s.payment_method}`, t);
  });

  subscribe(async ({ type, payload }) => {
    if (type !== 'sale.paid' || !getGroup('google').logSales || !calendar.isConnected()) return;
    const s = payload.sale;
    const sym = getGroup('business').currencySymbol;
    await calendar.createEvent({
      summary: `Sale ${s.invoice_no} · ${formatMoney(s.total, sym)}`,
      description: s.items.map((i) => `${i.qty} × ${i.name}`).join('\n'),
      start: s.paid_at || s.created_at,
    });
  });

  subscribe(async ({ type, payload }) => {
    if (type === 'sale.paid') await (await import('./services/printer.js')).onSalePaid(payload.sale);
  });

  log.info('notifiers started');
}
