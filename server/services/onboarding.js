// First-run setup: one call that writes the answers from the welcome wizard.
// Everything here could also be done by hand in Settings and Connectors; this just gets a new shop
// selling in a couple of minutes.
import { db, tx } from '../db.js';
import { badRequest } from '../lib.js';
import { getGroup, setGroup } from './settings.js';
import { createItem } from './items.js';

export const BUSINESS_TYPES = ['shop', 'restaurant', 'services'];

const SAMPLES = {
  shop: [
    ['Rice 1kg', 150, 'Grocery', '🍚'], ['Sugar 1kg', 120, 'Grocery', '🧂'], ['Cooking oil 1L', 290, 'Grocery', '🫗'],
    ['Biscuits', 30, 'Snacks', '🍪'], ['Noodles', 25, 'Snacks', '🍜'], ['Soap', 60, 'Household', '🧼'],
    ['Toothpaste', 110, 'Household', '🪥'], ['Mineral water', 30, 'Drinks', '💧'], ['Soft drink', 60, 'Drinks', '🥤'],
  ],
  restaurant: [
    ['Masala tea', 60, 'Drinks', '🍵'], ['Coffee', 150, 'Drinks', '☕'], ['Lassi', 120, 'Drinks', '🥛'],
    ['Veg momo', 180, 'Food', '🥟'], ['Chicken momo', 250, 'Food', '🥟'], ['Chowmein', 200, 'Food', '🍜'],
    ['Dal bhat set', 350, 'Food', '🍛'], ['Sandwich', 220, 'Snacks', '🥪'], ['Cake slice', 150, 'Bakery', '🍰'],
  ],
  services: [
    ['Haircut', 300, 'Services', '💇'], ['Shave', 150, 'Services', '🪒'], ['Hair colour', 1200, 'Services', '🎨'],
    ['Consultation (30 min)', 1000, 'Services', '🗓️'], ['Repair (per hour)', 800, 'Services', '🔧'], ['Delivery', 100, 'Services', '🛵'],
  ],
};

/** Show the welcome wizard? Only for a brand-new POS: not done yet and no products. */
export function needsWelcome() {
  if (getGroup('onboarding').done) return false;
  if (db.prepare('SELECT COUNT(*) AS n FROM items').get().n > 0) { setGroup('onboarding', { done: true }); return false; }
  return true;
}

export function sampleItems(type) { return (SAMPLES[type] || SAMPLES.shop).map(([name, price, category, emoji]) => ({ name, price, category, emoji })); }

export function complete(input = {}) {
  const type = BUSINESS_TYPES.includes(input.businessType) ? input.businessType : 'shop';
  const b = input.business || {};
  if (input.business && !String(b.name || '').trim()) throw badRequest('Give your shop a name');
  const own = Array.isArray(input.items) ? input.items.filter((i) => String(i?.name || '').trim() && Number(i.price) > 0).slice(0, 50) : [];
  const m = input.methods || {};
  let created = 0;
  tx(() => {
    if (input.business) setGroup('business', { name: String(b.name).trim(), address: b.address, phone: b.phone, pan: b.pan });
    if (input.vat !== undefined) {
      setGroup('tax', input.vat
        ? { label: 'VAT', rate: 13, inclusive: !!input.pricesIncludeTax, serviceChargeRate: type === 'restaurant' && input.serviceCharge ? 10 : 0 }
        : { label: 'Tax', rate: 0, inclusive: true, serviceChargeRate: type === 'restaurant' && input.serviceCharge ? 10 : 0 });
    }
    for (const it of [...own, ...(input.sample ? sampleItems(type) : [])]) {
      createItem({ name: String(it.name).trim().slice(0, 80), price: Number(it.price), category: String(it.category || 'General').slice(0, 40), emoji: it.emoji || '', stock: it.stock ?? null });
      created++;
    }
    if (input.methods) {
      setGroup('card', { enabled: !!m.card });
      setGroup('qr', { enabled: !!m.qr });
      for (const g of ['esewa', 'khalti', 'stripe']) setGroup(g, { enabled: !!m[g] && (g !== 'stripe' || !!getGroup('stripe').secretKey) });
    }
    setGroup('onboarding', { done: true, businessType: type });
  });
  return { ok: true, itemsCreated: created, finishInConnectors: ['khalti', 'stripe'].filter((g) => m[g]).concat(m.esewa ? ['esewa'] : []) };
}

export function skip() { setGroup('onboarding', { done: true }); return { ok: true }; }
