import { expect, it } from 'vitest';
import { resolveStyling, validateFeatureStyle } from '../src/core/feature-styling.js';
import { overlapRegions } from '../src/core/overlap-regions.js';
import { stripeImage } from '../src/maplibre/feature-styling.js';
import type { Coordinate, FeatureId, PolygonFeature } from '../src/index.js';

const box = (id: FeatureId, x: number, y: number, width = 4, height = 4): PolygonFeature => ({
  type: 'Feature', id, properties: {}, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]]] },
});
const area = (rings: Coordinate[][][]) => rings.reduce((total, part) => total + part.reduce((sum, ring, index) => {
  const value = Math.abs(ring.slice(1).reduce((a, point, i) => a + ring[i]![0] * point[1] - point[0] * ring[i]![1], 0)) / 2;
  return sum + (index === 0 ? value : -value);
}, 0), 0);

it('isolates and normalizes style options without inventing selection overrides', () => {
  const patch = { selected: { shape: { lineColor: '#ABC' } }, overlap: { enabled: true, palette: ['#F00', '#0F0'] } };
  const result = resolveStyling(patch);
  patch.selected.shape.lineColor = '#000'; patch.overlap.palette.push('#fff');
  expect(result.selected).toEqual({ shape: { lineColor: '#abc' } });
  expect(result.overlap).toEqual({ enabled: true, palette: ['#f00', '#0f0'], stripeWidth: 12, opacity: 0.7, direction: 'ascending' });
  expect(resolveStyling({})).toEqual({}); expect(resolveStyling({ selected: {} })).toEqual({ selected: {} });
  expect(validateFeatureStyle({ shape: { fillOpacity: 0 }, marker: { radius: 0 }, sortKey: -42 })).toEqual({ shape: { fillOpacity: 0 }, marker: { radius: 0 }, sortKey: -42 });
});

it.each([null, { selected: { sortKey: 1 } }, { feature: 1 }, { overlap: { enabled: undefined } }, { overlap: { direction: 'left' } },
  { overlap: { opacity: NaN } }, { overlap: { stripeWidth: 0 } }, { overlap: { palette: [] } }, { overlap: { palette: ['red'] } },
  { selected: { shape: { fillColor: 'red' } } }, { selected: undefined }, { overlap: { surprise: true } }])('rejects malformed configuration %j', value => {
  expect(() => resolveStyling(value as never)).toThrow();
});

it('partitions double and triple overlap into disjoint cells with exact member sets', () => {
  const polygons = [box('a', 0, 0), box('b', 2, 0), box('c', 1, 2)];
  const original = structuredClone(polygons); const cells = overlapRegions(polygons);
  const areas = new Map(cells.map(cell => [cell.members.join(''), area(cell.coordinates)]));
  expect([...areas.keys()].sort()).toEqual(['a', 'ab', 'abc', 'ac', 'b', 'bc', 'c']);
  expect(areas.get('abc')).toBeCloseTo(4, 8); expect([...areas.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(32, 8);
  for (const id of ['a', 'b', 'c']) expect(cells.filter(cell => cell.members.includes(id)).reduce((sum, cell) => sum + area(cell.coordinates), 0)).toBeCloseTo(16, 8);
  expect(polygons).toEqual(original); expect(overlapRegions([...polygons].reverse())).toEqual(cells);
});

it('excludes holes and boundary-only contact and supports multipart and typed IDs', () => {
  const donut = box(7, 0, 0, 10, 10); donut.geometry.coordinates.push([[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]]);
  expect(overlapRegions([donut, box('hole', 3, 3)]).every(cell => cell.members.length === 1)).toBe(true);
  const multi = { ...box('7', 0, 0), geometry: { type: 'MultiPolygon' as const, coordinates: [box('unused', 1, 1).geometry.coordinates, box('unused', 20, 20).geometry.coordinates] } };
  const result = overlapRegions([donut, multi]);
  expect(result.some(cell => cell.members.includes(7) && cell.members.includes('7'))).toBe(true);
  expect(overlapRegions([box('a', 0, 0), box('b', 4, 0)]).every(cell => cell.members.length === 1)).toBe(true);
});

it('bounds optional overlap work before running unbounded clipping', () => {
  expect(() => overlapRegions(Array.from({ length: 1001 }, (_, i) => box(i, 0, 0)))).toThrow('1,000');
  expect(() => overlapRegions([box('pole', 0, 86)])).toThrow('latitude');
});

it('generates seamless two/three-color textures with equal stripes and requested scale', () => {
  for (const colors of [['#ff0000', '#00ff00'], ['#ff0000', '#00ff00', '#0000ff']]) {
    const tile = stripeImage(colors, 12, false); const reversed = stripeImage(colors, 12, true);
    expect(Math.log2(tile.width) % 1).toBe(0); expect(tile.width / tile.pixelRatio / colors.length / Math.SQRT2).toBeCloseTo(12);
    const counts = [0, 0, 0];
    for (let i = 0; i < tile.data.length; i += 4) {
      expect(tile.data[i + 3]).toBe(255);
      for (let color = 0; color < 3; color++) if (tile.data[i + color] === 255) counts[color]!++;
    }
    for (const count of counts.slice(0, colors.length)) expect(Math.abs(count - tile.width ** 2 / colors.length)).toBeLessThanOrEqual(tile.width);
    expect(reversed.data).not.toEqual(tile.data);
  }
});
