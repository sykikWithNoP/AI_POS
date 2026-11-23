// Billing engine shared by the browser (instant totals) and the server (authoritative totals).
// All money is in minor units (paisa / cents) as integers, so there is no float drift.

/** Convert a major-unit amount ("12.50" or 12.5) to integer minor units. */
export function toMinor(major) {
  const n = typeof major === 'string' ? Number(major.replace(/,/g, '')) : Number(major);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Convert minor units to a major-unit number with 2 decimals. */
export function toMajor(minor) {
  return Math.round(minor) / 100;
}

export function formatMoney(minor, symbol = 'Rs.', locale = 'en-IN') {
  const sign = minor < 0 ? '-' : '';
  const v = Math.abs(minor) / 100;
  return `${sign}${symbol} ${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Split `amount` across `weights` proportionally, using largest remainder so parts sum exactly. */
export function allocate(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const parts = raw.map((r) => Math.floor(r));
  let rest = amount - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) parts[order[k][1]] += 1;
  return parts;
}

/**
 * Calculate a bill.
 * @param {Array<{qty:number, unitPrice:number, taxRate?:number|null, discount?:{type:'amount'|'percent', value:number}}>} lines
 *        unitPrice is minor units; discount.value is minor units (amount) or percent.
 * @param {{taxRate?:number, taxInclusive?:boolean, serviceChargeRate?:number,
 *          cartDiscount?:{type:'amount'|'percent', value:number}, extraDiscounts?:number[]}} opts
 */
export function calculateBill(lines, opts = {}) {
  const defaultRate = opts.taxRate ?? 13;
  const inclusive = !!opts.taxInclusive;
  const scRate = opts.serviceChargeRate ?? 0;

  const prepared = lines.map((l) => {
    const qty = Math.max(0, Number(l.qty) || 0);
    const unitPrice = Math.max(0, Math.round(Number(l.unitPrice) || 0));
    const gross = Math.round(unitPrice * qty);
    let lineDiscount = 0;
    if (l.discount && l.discount.value > 0) {
      lineDiscount = l.discount.type === 'percent'
        ? Math.round((gross * Math.min(100, l.discount.value)) / 100)
        : Math.round(l.discount.value);
    }
    lineDiscount = Math.min(gross, Math.max(0, lineDiscount));
    const rate = l.taxRate === null || l.taxRate === undefined || l.taxRate === '' ? defaultRate : Number(l.taxRate);
    return { ...l, qty, unitPrice, gross, lineDiscount, net: gross - lineDiscount, taxRate: rate };
  });

  const netSum = prepared.reduce((a, l) => a + l.net, 0);
  let cartDiscount = 0;
  const cd = opts.cartDiscount;
  if (cd && cd.value > 0) {
    cartDiscount = cd.type === 'percent' ? Math.round((netSum * Math.min(100, cd.value)) / 100) : Math.round(cd.value);
  }
  for (const extra of opts.extraDiscounts || []) cartDiscount += Math.max(0, Math.round(extra || 0));
  cartDiscount = Math.min(netSum, Math.max(0, cartDiscount));
  const shares = allocate(cartDiscount, prepared.map((l) => l.net));

  let subtotal = 0, discount = 0, serviceCharge = 0, taxable = 0, exempt = 0, tax = 0, total = 0;
  const outLines = prepared.map((l, i) => {
    const afterDiscount = l.net - shares[i];
    let base, lineTax, sc;
    if (inclusive) {
      // Price already contains service charge + VAT; back them out.
      const gross = afterDiscount;
      lineTax = l.taxRate > 0 ? Math.round((gross * l.taxRate) / (100 + l.taxRate)) : 0;
      const preTax = gross - lineTax;
      sc = scRate > 0 ? Math.round((preTax * scRate) / (100 + scRate)) : 0;
      base = preTax - sc;
    } else {
      base = afterDiscount;
      sc = Math.round((base * scRate) / 100);
      lineTax = Math.round(((base + sc) * l.taxRate) / 100);
    }
    const lineTotal = base + sc + lineTax;
    subtotal += l.gross;
    discount += l.lineDiscount + shares[i];
    serviceCharge += sc;
    if (l.taxRate > 0) taxable += base + sc; else exempt += base + sc;
    tax += lineTax;
    total += lineTotal;
    return { ...l, cartDiscountShare: shares[i], base, serviceCharge: sc, tax: lineTax, total: lineTotal };
  });

  return { lines: outLines, subtotal, discount, serviceCharge, taxable, exempt, tax, total, itemCount: prepared.reduce((a, l) => a + l.qty, 0) };
}

/** Suggested quick-cash tender amounts (minor units) for a total. */
export function quickTenders(total) {
  const notes = [10, 20, 50, 100, 500, 1000].map((n) => n * 100);
  const out = new Set([total]);
  for (const n of notes) out.add(Math.ceil(total / n) * n);
  return [...out].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
}
