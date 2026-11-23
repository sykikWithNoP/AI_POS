import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBill, allocate, toMinor, quickTenders } from '../shared/billing.js';

test('toMinor handles strings, commas and floats without drift', () => {
  assert.equal(toMinor('1,234.56'), 123456);
  assert.equal(toMinor(0.1 + 0.2), 30);
  assert.equal(toMinor('abc'), 0);
});

test('allocate splits exactly by weight', () => {
  const parts = allocate(100, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(parts.sort(), [33, 33, 34]);
});

test('VAT exclusive with exempt line', () => {
  const b = calculateBill([{ qty: 2, unitPrice: 18000 }, { qty: 1, unitPrice: 6000, taxRate: 0 }], { taxRate: 13 });
  assert.equal(b.subtotal, 42000);
  assert.equal(b.taxable, 36000);
  assert.equal(b.exempt, 6000);
  assert.equal(b.tax, 4680);
  assert.equal(b.total, 46680);
});

test('VAT inclusive backs tax out of the price', () => {
  const b = calculateBill([{ qty: 1, unitPrice: 11300 }], { taxRate: 13, taxInclusive: true });
  assert.equal(b.tax, 1300);
  assert.equal(b.taxable, 10000);
  assert.equal(b.total, 11300);
});

test('line + cart discounts and service charge before VAT', () => {
  const b = calculateBill(
    [{ qty: 1, unitPrice: 10000, discount: { type: 'percent', value: 10 } }, { qty: 1, unitPrice: 10000 }],
    { taxRate: 13, serviceChargeRate: 10, cartDiscount: { type: 'amount', value: 1900 } });
  // net 9000 + 10000 = 19000, cart discount 1900 -> 17100; SC 10% = 1710; VAT 13% of 18810 = 2445.3
  assert.equal(b.discount, 1000 + 1900);
  assert.equal(b.serviceCharge, 1710);
  assert.equal(b.tax, 2445);
  assert.equal(b.total, 17100 + 1710 + 2445);
});

test('discount can never exceed the amount', () => {
  const b = calculateBill([{ qty: 1, unitPrice: 500, discount: { type: 'amount', value: 9999 } }], { taxRate: 13, extraDiscounts: [100] });
  assert.equal(b.total, 0);
});

test('quick tenders are >= total and ascending', () => {
  const t = quickTenders(32340);
  assert.equal(t[0], 32340);
  assert.ok(t.every((v, i) => i === 0 || v > t[i - 1]));
});
