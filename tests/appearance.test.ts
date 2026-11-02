import { expect, it } from 'vitest';
import { polygonOutlineScale, resolveAppearance, type EditorAppearanceOptions } from '../src/core/appearance.js';

it('preserves existing defaults and merges individual fields without sharing snapshots', () => {
  const original = resolveAppearance();
  expect(original.feature).toEqual({ lineColor: '#116b5b', lineWidth: 4, lineOpacity: 1, fillColor: '#116b5b', fillOpacity: 0.18 });
  const patch = { draft: { lineColor: '#ABC', fillOpacity: 0.5 }, vertex: { radius: 9 } };
  const next = resolveAppearance(patch, original);
  expect(next.draft).toEqual({ ...original.draft, lineColor: '#abc', fillOpacity: 0.5 });
  expect(next.vertex).toEqual({ ...original.vertex, radius: 9 });
  expect(next.selected).toEqual(original.selected);
  patch.draft.lineColor = '#000'; next.selected.lineWidth = 20;
  expect(next.draft.lineColor).toBe('#abc');
  expect(original.selected.lineWidth).toBe(6);
  original.feature.lineColor = '#000';
  expect(resolveAppearance().feature.lineColor).toBe('#116b5b');
});

it.each([
  null, [], 'blue', { unknown: {} }, { draft: null }, { feature: [] },
  { feature: { typo: 2 } }, { feature: { lineColor: 'red' } },
  { feature: { lineColor: 'var(--color)' } }, { feature: { lineColor: '#1234' } },
  { feature: { lineColor: 'url(https://example.com)' } },
  { selected: { fillColor: '#gggggg' } }, { vertex: { activeColor: undefined } },
  { draft: { fillOpacity: NaN } }, { selected: { lineOpacity: Infinity } },
  { feature: { lineWidth: '4' } }, { midpoint: { radius: -1 } },
  { snap: { edgeRadius: 33 } }, { pivot: { strokeWidth: 17 } },
  { draft: { fillOpacity: 1.01 } }, { vertex: { activeRadius: 33 } },
  { polygonOutline: { scaleWithZoom: 1 } }, { polygonOutline: { scaleWithZoom: undefined } },
  { polygonOutline: { referenceZoom: -1 } }, { polygonOutline: { referenceZoom: 24.1 } },
  { polygonOutline: { referenceZoom: NaN } }, { polygonOutline: { referenceZoom: '14' } },
])('rejects invalid patches atomically: %j', (patch) => {
  const current = resolveAppearance(); const before = resolveAppearance();
  expect(() => resolveAppearance(patch as EditorAppearanceOptions, current)).toThrow();
  expect(current).toEqual(before);
});

it('scales polygon outlines smoothly below the reference, caps zooming in and isolates snapshots', () => {
  const current = resolveAppearance();
  expect(current.polygonOutline).toEqual({ scaleWithZoom: false, referenceZoom: 14 });
  expect(polygonOutlineScale(8, current.polygonOutline)).toBe(1);
  const next = resolveAppearance({ polygonOutline: { scaleWithZoom: true, referenceZoom: 15.5 } }, current);
  for (const zoom of [-2, 0, 12.5, 14, 15, 15.5, 18, 24]) {
    expect(polygonOutlineScale(zoom, next.polygonOutline)).toBeCloseTo(Math.min(1, 2 ** (zoom - 15.5)), 12);
  }
  next.polygonOutline.referenceZoom = 10;
  expect(current.polygonOutline.referenceZoom).toBe(14);
  expect(resolveAppearance({ polygonOutline: { referenceZoom: 0 } }).polygonOutline.referenceZoom).toBe(0);
  expect(resolveAppearance({ polygonOutline: { referenceZoom: 24 } }).polygonOutline.referenceZoom).toBe(24);
});

it('rejects a later invalid field without applying earlier valid fields', () => {
  const current = resolveAppearance();
  expect(() => resolveAppearance({ feature: { lineColor: '#f00' }, snap: { radius: -1 } }, current)).toThrow('appearance.snap.radius');
  expect(current).toEqual(resolveAppearance());
});

it('accepts explicit zeroes and maximum sizes without using truthy fallback defaults', () => {
  const next = resolveAppearance({ feature: { lineWidth: 0, lineOpacity: 0, fillOpacity: 0 },
    vertex: { radius: 32, activeRadius: 32, strokeWidth: 16, opacity: 0 }, snap: { edgeRadius: 0 } });
  expect(next.feature.lineWidth).toBe(0); expect(next.feature.fillOpacity).toBe(0);
  expect(next.vertex.radius).toBe(32); expect(next.vertex.opacity).toBe(0); expect(next.snap.edgeRadius).toBe(0);
});
