// Made-up closings that follow the same rules as the real envelopes.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dinnerClose, lunchClose, splitTips, toCents, fmt } from '../js/calc.js';

const days = [
  {
    name: 'dinner split by hours',
    receipt: { cash: 61234, credit: 912345, gratuity: 125678, subtotal: 847901 },
    lunch: { cash: 15020, cardSales: 140010, creditTips: 25500, cashTips: 6000 },
    cashTips: 9050,
    servers: [{ name: 'Server A', hours: 4.5 }, { name: 'Server B', hours: 5 }, { name: 'Server C', hours: 5.5 }],
    expect: { cash: 46214, cb: 55264, allCB: 76284, creditTips: 100178, tips: 109228, cardTotal: 746835, cardSales: 646657, total: 692871, allSales: 847901 },
    tips: [32765, 36405, 40058],
  },
  {
    name: 'Offline C.C. counts as card money; no hours = even split',
    receipt: { cash: 40000, credit: 380000, offline: 9000, gratuity: 60000, subtotal: 369000 },
    lunch: { cash: 5000, cardSales: 100000, creditTips: 18000, cashTips: 0 },
    cashTips: 4500,
    servers: [{ name: 'Server A', hours: '' }, { name: 'Server B', hours: '' }],
    expect: { cash: 35000, cb: 39500, allCB: 44500, creditTips: 42000, tips: 46500, cardTotal: 271000, cardSales: 229000, total: 264000, allSales: 369000 },
    tips: [23250, 23250],
  },
];

for (const d of days) {
  test(`dinner close: ${d.name}`, () => {
    const r = dinnerClose(d);
    for (const [k, v] of Object.entries(d.expect)) assert.equal(r[k], v, k);
    assert.ok(r.checks.every(c => c.ok), 'all checks pass');
    assert.deepEqual(r.split.rows.map(s => s.tip), d.tips);
  });
}

test('lunch close', () => {
  const r = lunchClose({
    receipt: { cash: 9000, credit: 240000, gratuity: 28000, subtotal: 221000 },
    cashTips: 10000,
    servers: [{ name: 'Server A', hours: 4 }, { name: 'Server B', hours: 3.5 }],
  });
  assert.equal(r.cardSales, 212000);
  assert.equal(r.total, 221000);
  assert.equal(r.tips, 38000);
  assert.equal(r.cb, 19000);
  assert.ok(r.checks.every(c => c.ok));
  assert.deepEqual(r.split.rows.map(s => s.tip), [20264, 17736]);
});

test('same hours get the same tips; leftover goes to someone with unique hours', () => {
  const s = splitTips(166003, [{ name: 'A', hours: 4 }, { name: 'N', hours: 5.5 }, { name: 'V', hours: 5 }, { name: 'Z', hours: 5 }]);
  assert.equal(s.rate, 8512);
  assert.deepEqual(s.rows.map(r => r.tip), [34048, 46835, 42560, 42560]);
});

test('no unique hours: leftover is shared inside one same-hours group', () => {
  const s = splitTips(10002, [{ name: 'A', hours: 5 }, { name: 'B', hours: 5 }, { name: 'C', hours: 4 }, { name: 'D', hours: 4 }]);
  assert.deepEqual(s.rows.map(r => r.tip), [2775, 2775, 2226, 2226]);
});

test('rate is cut to whole cents', () => {
  const s = splitTips(113196, [{ name: 'A', hours: 4 }, { name: 'B', hours: 4 }, { name: 'C', hours: 4 }, { name: 'D', hours: 7.5 }]);
  assert.equal(s.rate, 5804);
  assert.deepEqual(s.rows.map(r => r.tip), [23216, 23216, 23216, 43548]);
});

test('same hours for everyone splits evenly per person', () => {
  const s = splitTips(102275, [{ name: 'A', hours: 4.5 }, { name: 'B', hours: 4.5 }, { name: 'C', hours: 4.5 }]);
  assert.deepEqual(s.rows.map(r => r.tip), [34091, 34091, 34093]);
});

test('single lunch server gets everything', () => {
  const s = splitTips(31111, [{ name: 'Server A', hours: '' }]);
  assert.deepEqual(s.rows.map(r => r.tip), [31111]);
});

test('money helpers', () => {
  assert.equal(toCents('1,131.52'), 113152);
  assert.equal(toCents('105.-'), 10500);
  assert.equal(toCents(''), null);
  assert.equal(fmt(742899), '7,428.99');
  assert.equal(fmt(-62303), '-623.03');
});
