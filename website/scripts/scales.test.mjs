import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { classColor, classIndex, classRanges, classScale, compactNumber, niceAxis, niceStep, roundSignificant, tickFormatter, UNKNOWN } from '../src/lib/scales.ts';

test('axes extend to round steps of 1, 2, 2.5 or 5 × 10ⁿ', () => {
  assert.deepEqual(niceAxis(92, 175).ticks, [75, 100, 125, 150, 175]);
  assert.deepEqual(niceAxis(300000, 550000).ticks, [300000, 400000, 500000, 600000]);
  assert.deepEqual(niceAxis(0.1, 5.8).ticks, [0, 2, 4, 6], 'non-negative data never gets a negative lower bound');
  assert.deepEqual(niceAxis(-15, 73).ticks, [-25, 0, 25, 50, 75]);
  assert.deepEqual(niceAxis(0, 0.7).ticks, [0, 0.2, 0.4, 0.6, 0.8], 'decimal ticks carry no floating-point noise');
  assert.equal(niceStep(83, 4), 25);
  assert.equal(niceStep(0, 4), 1);
});

test('count axes keep zero and whole numbers', () => {
  assert.deepEqual(niceAxis(0, 3, { zero: true, integer: true }).ticks, [0, 1, 2, 3]);
  assert.deepEqual(niceAxis(0, 37, { zero: true, integer: true }).ticks, [0, 10, 20, 30, 40]);
  assert.deepEqual(niceAxis(4, 9, { zero: true, integer: true }).ticks, [0, 5, 10]);
  for (const tick of niceAxis(0, 7, { zero: true, integer: true }).ticks) assert.ok(Number.isInteger(tick));
});

test('a flat or empty series still gets a usable axis', () => {
  const flat = niceAxis(5, 5);
  assert.ok(flat.min < 5 && flat.max > 5);
  assert.deepEqual(niceAxis(Infinity, -Infinity).ticks, [0, 0.25, 0.5, 0.75, 1]);
});

test('tick labels share one unit per axis', () => {
  const euro = tickFormatter([0, 500000, 1000000, 1500000], 'euro');
  assert.deepEqual([0, 500000, 1000000, 1500000].map(euro), ['€ 0', '€ 0,5 mln', '€ 1 mln', '€ 1,5 mln']);
  const thousands = tickFormatter([300000, 400000, 500000]);
  assert.deepEqual([300000, 400000].map(thousands), ['300k', '400k']);
  assert.deepEqual([75, 100, 125].map(tickFormatter([75, 100, 125])), ['75', '100', '125']);
  assert.equal(tickFormatter([-25, 0, 25], 'percent')(-25), '-25 %');
  assert.equal(tickFormatter([0, 0.25, 0.5])(0.25), '0,25');
});

test('legend values pick their own short unit', () => {
  assert.equal(compactNumber(2286000, { euro: true }), '€ 2,3 mln');
  assert.equal(compactNumber(390000, { euro: true }), '€ 390k');
  assert.equal(compactNumber(1100), '1.100');
  assert.equal(compactNumber(0.4), '0,4');
  assert.equal(compactNumber(-1.9), '-1,9');
  assert.equal(roundSignificant(412337), 410000);
  assert.equal(roundSignificant(2.7778), 2.8);
  assert.equal(roundSignificant(-0.0456), -0.046);
});

test('quantile classes split skewed WOZ values into five readable groups', () => {
  const { data } = JSON.parse(readFileSync(new URL('../src/features/housing/snapshot.json', import.meta.url)));
  const values = data.features.map((f) => f.properties.woz);
  const scale = classScale(values);
  assert.equal(scale.colors.length, 5);
  assert.equal(scale.breaks.length, 4);
  for (const value of scale.breaks) assert.equal(value, roundSignificant(value), 'breaks are rounded');
  const known = values.filter((v) => typeof v === 'number');
  const counts = scale.colors.map((_, index) => known.filter((v) => classIndex(v, scale.breaks) === index).length);
  // A linear scale put almost every neighbourhood in the lightest fifth; quantiles keep each class near 20 %.
  for (const count of counts) assert.ok(count > known.length * 0.12 && count < known.length * 0.28, `class sizes ${counts}`);
  assert.equal(classColor(null, scale), UNKNOWN);
  assert.equal(classRanges(scale)[0].from, Math.min(...known));
  assert.equal(classRanges(scale).at(-1).to, Math.max(...known));
});

test('diverging classes keep decreases apart from increases', () => {
  const scale = classScale([-12, -6, -3, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30], { diverging: true });
  assert.ok(scale.diverging);
  assert.ok(scale.breaks.includes(0));
  const zero = classIndex(0, scale.breaks);
  assert.notEqual(classColor(-1, scale), classColor(0, scale), 'a fall is never shown in a rise colour');
  assert.equal(classColor(0, scale), scale.colors[zero]);
  assert.equal(classColor(-12, scale), scale.colors[0]);
  assert.equal(scale.breaks.length + 1, scale.colors.length);
  const rising = classScale([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { diverging: true });
  assert.equal(rising.diverging, false, 'without decreases the scale is sequential');
});

test('ties and tiny inputs merge classes instead of leaving empty ones', () => {
  const tied = classScale([0, 0, 0, 0, 0, 0, 0, 0, 5, 9]);
  assert.equal(tied.breaks.length + 1, tied.colors.length);
  assert.ok(tied.breaks.every((value, index) => index === 0 || value > tied.breaks[index - 1]));
  const flat = classScale([2, 2, 2]);
  assert.deepEqual(flat.breaks, []);
  assert.equal(flat.colors.length, 1);
  assert.deepEqual(classScale([]).breaks, []);
  const falling = classScale([-5, -4, -3, -2, -1], { diverging: true });
  assert.equal(falling.breaks.length + 1, falling.colors.length);
});
