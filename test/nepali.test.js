import test from 'node:test';
import assert from 'node:assert/strict';
import { bsDate, fiscalYear, fyTag, bsMonthRange } from '../server/nepali.js';

test('BS conversion matches known new-year dates', () => {
  assert.equal(bsDate(new Date(2023, 3, 14)), '2080.01.01');
});

test('fiscal year flips on 1 Shrawan', () => {
  assert.equal(fiscalYear(new Date(2025, 6, 16)), '2081.082'); // Asar end
  assert.equal(fiscalYear(new Date(2025, 6, 17)), '2082.083'); // 2082 Shrawan 1
  assert.equal(fyTag('2082.083'), '8283');
});

test('BS month range is contiguous', () => {
  const a = bsMonthRange(new Date(2026, 10, 23), 0);
  const b = bsMonthRange(new Date(2026, 10, 23), 1);
  assert.equal(a.end.getTime(), b.start.getTime());
  assert.match(a.label, /2083/);
});
