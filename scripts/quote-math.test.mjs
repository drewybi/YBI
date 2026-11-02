import assert from 'assert';
import { centsToInput, gstOn, lineCents, milliToQty, priceToCents, qtyToMilli, quoteTotals } from '../public/assets/quote-math.mjs';

assert.strictEqual(priceToCents(''), null);
assert.strictEqual(priceToCents('  $1,200.50 '), 120050);
assert.strictEqual(priceToCents('10'), 1000);
assert.strictEqual(priceToCents('10.5'), 1050);
assert.strictEqual(priceToCents('1.005'), undefined);
assert.strictEqual(priceToCents('-5'), undefined);
assert.strictEqual(qtyToMilli(''), null);
assert.strictEqual(qtyToMilli('2'), 2000);
assert.strictEqual(qtyToMilli('2.5'), 2500);
assert.strictEqual(qtyToMilli('0'), 0);
assert.strictEqual(qtyToMilli('1.0001'), undefined);
assert.strictEqual(milliToQty(2500), '2.5');
assert.strictEqual(milliToQty(2000), '2');
assert.strictEqual(centsToInput(1050), '10.50');

// Blank quantity is 1. An explicit 0 is free.
assert.strictEqual(lineCents(null, 10000), 10000);
assert.strictEqual(lineCents(0, 10000), 0);
assert.strictEqual(lineCents(2000, 5000), 10000);
assert.strictEqual(lineCents(500000, 40), 20000);

const mixed = quoteTotals([
  { description: 'Design', qty: '', price: '450' },
  { description: 'Cards', qty: '500', price: '0.40' },
  { description: '', qty: '', price: '' }
]);
assert.deepStrictEqual(mixed.errors, []);
assert.strictEqual(mixed.amounts[0], 45000);
assert.strictEqual(mixed.amounts[1], 20000);
assert.strictEqual(mixed.amounts[2], 0);
assert.strictEqual(mixed.subtotal, 65000);
assert.strictEqual(mixed.gst, 6500);
assert.strictEqual(mixed.total, 71500);

// 10% of $1.05 is 10.5 cents, rounded half up to 11.
assert.strictEqual(gstOn(105), 11);
const gst = quoteTotals([{ qty: '', price: '1.05' }]);
assert.strictEqual(gst.subtotal, 105);
assert.strictEqual(gst.gst, 11);
assert.strictEqual(gst.total, 116);

const bad = quoteTotals([{ qty: 'nope', price: '12.345' }]);
assert.strictEqual(bad.amounts[0], null);
assert.strictEqual(bad.subtotal, 0);
assert.ok(bad.errors.length === 2);

console.log('quote-math: ok');
