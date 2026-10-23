import { expect, it } from 'vitest';
import { edgeDots } from '../src/maplibre/preview-border.js';

it('adds dots at the end of a growing edge without redistributing existing dots', () => {
  const start = { x: 10, y: 20 };
  const original = edgeDots(start, { x: 110, y: 20 }, 700, 500);
  const extended = edgeDots(start, { x: 170, y: 20 }, 700, 500);
  expect(original.map(({ x }) => x)).toEqual([10, 19, 28, 37, 46, 55, 64, 73, 82, 91, 100, 109]);
  expect(extended.slice(0, original.length)).toEqual(original);
});

it('moves dots with a translated edge and keeps their offsets fixed', () => {
  const original = edgeDots({ x: 10, y: 10 }, { x: 190, y: 250 }, 700, 500);
  const moved = edgeDots({ x: 50, y: 80 }, { x: 230, y: 320 }, 700, 500);
  expect(moved).toEqual(original.map(({ x, y }) => ({ x: x + 40, y: y + 70 })));
});

it('clips visible dot indices without resetting their edge origin', () => {
  const dots = edgeDots({ x: -100, y: 20 }, { x: 200, y: 20 }, 100, 100);
  expect(dots.map(({ x }) => Math.round(x * 1e9) / 1e9)).toEqual([-1, 8, 17, 26, 35, 44, 53, 62, 71, 80, 89, 98]);
  expect(edgeDots({ x: -100, y: -10 }, { x: 200, y: -10 }, 100, 100)).toEqual([]);
  expect(edgeDots({ x: 10, y: 10 }, { x: 10, y: 10 }, 100, 100)).toEqual([]);
});

it('bounds work for enormous offscreen edges and reserves room for editing handles', () => {
  const dots = edgeDots({ x: -1e12, y: 20 }, { x: 1e12, y: 20 }, 700, 500);
  expect(dots.length).toBeGreaterThan(70); expect(dots.length).toBeLessThan(80);
  expect(dots.every(({ x }) => x >= -2 && x <= 702)).toBe(true);
  expect(edgeDots({ x: 0, y: 0 }, { x: 30, y: 0 }, 700, 500, 8)).toEqual([{ x: 9, y: 0 }, { x: 18, y: 0 }]);
});
