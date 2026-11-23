// Bikram Sambat (BS) dates and Nepal fiscal years (FY starts 1 Shrawan).
import NepaliDate from 'nepali-date-converter';

/** BS date "YYYY.MM.DD" for a JS Date, as IRD CBMS expects. */
export function bsDate(date = new Date()) {
  return new NepaliDate(date).format('YYYY.MM.DD');
}

/** Fiscal year like "2083.084" (IRD format). */
export function fiscalYear(date = new Date()) {
  const nd = new NepaliDate(date);
  const y = nd.getYear();
  const start = nd.getMonth() >= 3 ? y : y - 1; // month is 0-based; Shrawan = 3
  return `${start}.${String(start + 1).slice(1)}`;
}

/** Short FY tag for invoice numbers, e.g. "8384". */
export const fyTag = (fy) => fy.slice(2, 4) + fy.slice(-2);

const BS_MONTHS = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];

/** AD [start, end) range plus label for the BS month containing `date`, shifted by `offset` months. */
export function bsMonthRange(date = new Date(), offset = 0) {
  const nd = new NepaliDate(date);
  let y = nd.getYear(), m = nd.getMonth() + offset;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const start = new NepaliDate(y, m, 1).toJsDate();
  const ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
  const end = new NepaliDate(ny, nm, 1).toJsDate();
  return { start, end, label: `${BS_MONTHS[m]} ${y}` };
}

/** AD calendar month range shifted by `offset` months (local time). */
export function adMonthRange(date = new Date(), offset = 0) {
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + offset + 1, 1);
  return { start, end, label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }) };
}

/** AD [start, end) for the BS year containing `date`, shifted by `offset` years (Baisakh 1 → Baisakh 1). */
export function bsYearRange(date = new Date(), offset = 0) {
  const y = new NepaliDate(date).getYear() + offset;
  return { start: new NepaliDate(y, 0, 1).toJsDate(), end: new NepaliDate(y + 1, 0, 1).toJsDate(), label: `${y} BS` };
}

/** BS month names for each of the 12 months of a BS year (for chart labels). */
export const BS_MONTH_NAMES = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
