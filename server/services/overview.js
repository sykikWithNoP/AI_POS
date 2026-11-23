// Overview: Today / This month / This year, each with KPIs vs the previous period,
// a time series, payment mix, top items, busy hours, stock alerts and IRD status.
import { db } from '../db.js';
import { badRequest } from '../lib.js';
import { getGroup } from './settings.js';
import { outstanding } from './sales.js';
import { adMonthRange, bsMonthRange, bsYearRange, BS_MONTH_NAMES } from '../nepali.js';

export const PERIODS = ['day', 'month', 'year'];

function dayRange(date, offset) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const label = offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : start.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return { start, end, label };
}

function yearRange(date, offset, cal) {
  if (cal === 'BS') return bsYearRange(date, offset);
  const y = date.getFullYear() + offset;
  return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: String(y) };
}

export function periodRange(period, offset = 0, cal = getGroup('business').calendar, now = new Date()) {
  if (period === 'day') return dayRange(now, offset);
  if (period === 'month') return cal === 'BS' ? bsMonthRange(now, offset) : adMonthRange(now, offset);
  if (period === 'year') return yearRange(now, offset, cal);
  throw badRequest('period must be day, month or year');
}

const kpiStmt = () => db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(tax),0) AS tax,
    COALESCE(SUM(discount),0) AS discount FROM sales WHERE status = 'paid' AND created_at >= ? AND created_at < ?`);

// Net revenue = paid sales − refunds made in the same window (refunds count when they happen).
const refundStmt = () => db.prepare('SELECT COALESCE(SUM(amount),0) AS refunds, COALESCE(SUM(tax),0) AS refundTax FROM refunds WHERE created_at >= ? AND created_at < ?');
function netKpi(from, to) {
  const k = kpiStmt().get(from, to);
  const r = refundStmt().get(from, to);
  return { ...k, gross: k.revenue, refunds: r.refunds, revenue: k.revenue - r.refunds, tax: k.tax - r.refundTax };
}

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Time buckets for the chart: hours of a day, days of a month, months of a year. */
function buckets(period, range, cal) {
  if (period === 'day') return Array.from({ length: 24 }, (_, h) => ({ key: h, label: `${h}`, start: new Date(range.start.getTime() + h * 3600_000) }));
  if (period === 'month') {
    const out = [];
    for (let d = new Date(range.start); d < range.end; d.setDate(d.getDate() + 1)) out.push({ key: localDate(d), label: String(out.length + 1), start: new Date(d) });
    return out;
  }
  if (cal === 'BS') return BS_MONTH_NAMES.map((name, i) => ({ key: i, label: name.slice(0, 3), start: bsMonthRange(range.start, i).start }));
  return Array.from({ length: 12 }, (_, i) => ({ key: i, label: new Date(2000, i, 1).toLocaleString('en-US', { month: 'short' }), start: new Date(range.start.getFullYear(), i, 1) }));
}

export function overview({ period = 'month', offset = 0 } = {}) {
  if (!PERIODS.includes(period)) throw badRequest('period must be day, month or year');
  const cal = getGroup('business').calendar;
  const range = periodRange(period, offset, cal);
  const prev = periodRange(period, offset - 1, cal);
  const from = range.start.toISOString(), to = range.end.toISOString();
  const cur = netKpi(from, to);
  const last = netKpi(prev.start.toISOString(), prev.end.toISOString());

  const { profit } = db.prepare(`SELECT COALESCE(SUM(si.total - si.tax - COALESCE(i.cost,0) * si.qty), 0) AS profit
      FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN items i ON i.id = si.item_id
      WHERE s.status = 'paid' AND s.created_at >= ? AND s.created_at < ?`).get(from, to);
  const counts = db.prepare('SELECT status, COUNT(*) AS n FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY status').all(from, to);

  // Series: assign each paid sale to the last bucket whose start <= sale time.
  const series = buckets(period, range, cal).map((b) => ({ ...b, revenue: 0, bills: 0 }));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, bills: 0 }));
  const paid = db.prepare("SELECT created_at, total FROM sales WHERE status = 'paid' AND created_at >= ? AND created_at < ? ORDER BY created_at").all(from, to);
  let bi = 0;
  for (const s of paid) {
    const t = new Date(s.created_at);
    while (bi + 1 < series.length && series[bi + 1].start <= t) bi++;
    series[bi].revenue += s.total; series[bi].bills++;
    hours[t.getHours()].revenue += s.total; hours[t.getHours()].bills++;
  }
  const now = new Date();
  const currentKey = period === 'day' ? now.getHours() : period === 'month' ? localDate(now) : series.findLastIndex((b) => b.start <= now);

  const methods = db.prepare(`SELECT p.method, COUNT(*) AS n, SUM(p.amount) AS amount FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE p.status = 'verified' AND s.status = 'paid' AND s.created_at >= ? AND s.created_at < ? GROUP BY p.method ORDER BY amount DESC`).all(from, to);
  const topItems = db.prepare(`SELECT si.name, SUM(si.qty) AS qty, SUM(si.total) AS revenue FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.status = 'paid' AND s.created_at >= ? AND s.created_at < ? GROUP BY si.name ORDER BY revenue DESC LIMIT 8`).all(from, to);
  const ird = db.prepare('SELECT ird_status, COUNT(*) AS n FROM sales WHERE created_at >= ? AND created_at < ? GROUP BY ird_status').all(from, to);
  const lowStock = db.prepare('SELECT id, name, stock, unit FROM items WHERE active = 1 AND stock IS NOT NULL AND stock <= 5 ORDER BY stock LIMIT 10').all();

  return {
    period, offset, label: range.label, calendar: cal, from, to, prevLabel: prev.label,
    kpis: { ...cur, profit, avgTicket: cur.bills ? Math.round(cur.gross / cur.bills) : 0, prevRevenue: last.revenue, prevBills: last.bills },
    statusCounts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    series: series.map(({ key, label, revenue, bills }) => ({ key, label, revenue, bills, current: offset === 0 && key === currentKey })),
    hours, methods, topItems, lowStock,
    ird: Object.fromEntries(ird.map((r) => [r.ird_status, r.n])),
    snapshot: snapshot(cal),
    outstanding: outstanding(),
  };
}

/** Always-visible strip: today, this month, this year. */
export function snapshot(cal = getGroup('business').calendar) {
  return Object.fromEntries(PERIODS.map((p) => {
    const r = periodRange(p, 0, cal);
    const k = netKpi(r.start.toISOString(), r.end.toISOString());
    return [p, { label: r.label, revenue: k.revenue, bills: k.bills }];
  }));
}

/** Backwards-compatible month overview (used by the AI copilot context). */
export const monthOverview = (offset = 0) => overview({ period: 'month', offset });

export function daySummary(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const k = kpiStmt().get(start.toISOString(), end.toISOString());
  const methods = db.prepare(`SELECT p.method, SUM(p.amount) AS amount FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.status='verified' AND s.status='paid' AND s.created_at >= ? AND s.created_at < ? GROUP BY p.method`).all(start.toISOString(), end.toISOString());
  return { date: localDate(start), ...k, methods };
}
