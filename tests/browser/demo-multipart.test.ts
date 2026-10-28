import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Coordinate, GeometryFeatureCollection, MultiLineFeature, MultiPolygonFeature } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';
import fixture from '../../examples/basic/public/multipart.geojson?raw';

it('imports multipart examples, chooses a component and hole, edits, deletes and restores via the demo controls', async () => {
  const spy = vi.spyOn(Map.prototype, 'fitBounds');
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach((script) => { script.remove(); });
    await import('../../examples/basic/main.js');
    const input = page.getByLabelText('Import GeoJSON'); await expect.element(input).toBeEnabled();
    await input.upload(new File([fixture], 'multipart.geojson', { type: 'application/geo+json' }));
    await expect.poll(() => spy.mock.contexts[0]).toBeDefined();
    const instance = spy.mock.contexts[0];
    if (!(instance instanceof Map)) throw new Error('Expected the demo map to fit imported data.');
    const map = instance;
    const canvas = document.querySelector('canvas')!;
    const output = (): GeometryFeatureCollection => JSON.parse(document.querySelector<HTMLTextAreaElement>('#output')!.value) as GeometryFeatureCollection;
    const original = output(); expect(original.features.map((f) => f.geometry.type)).toEqual(['MultiPolygon', 'MultiLineString']);
    // The bounds include the distant line endpoint, not only the first component.
    expect(map.getBounds().contains([4.898, 52.365])).toBe(true);
    const click = async (coordinate: Coordinate) => { await userEvent.click(canvas, { position: map.project(coordinate) }); };
    const sourceId = Object.keys(map.getStyle().sources).find((id) => id.endsWith('-features'))!;
    await expect.poll(() => map.queryRenderedFeatures(map.project([4.8925, 52.3705]), {
      layers: [sourceId.replace(/-features$/, '-fill')],
    }).length, { timeout: 10_000 }).toBeGreaterThan(0);
    await click([4.8925, 52.3705]); expect(document.querySelector('#selection-type')!.textContent).toBe('MultiPolygon');
    const parts = page.getByRole('combobox', { name: 'Part to edit' });
    await expect.element(parts).toBeVisible(); await userEvent.selectOptions(parts, '1');
    const rings = page.getByRole('combobox', { name: 'Ring to edit' }); await userEvent.selectOptions(rings, '1');
    await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
    await expect.element(parts).toBeDisabled();
    const beforePoint = map.project([4.894, 52.372]); const afterPoint = map.project([4.8937, 52.3717]);
    await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: beforePoint, targetPosition: afterPoint });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const edited = output().features[0] as MultiPolygonFeature; const before = original.features[0] as MultiPolygonFeature;
    expect(edited.geometry.coordinates[0]).toEqual(before.geometry.coordinates[0]);
    expect(edited.geometry.coordinates[1]![0]).toEqual(before.geometry.coordinates[1]![0]);
    expect(edited.geometry.coordinates[1]![1]).not.toEqual(before.geometry.coordinates[1]![1]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Delete hole', exact: true }).click(); expect((output().features[0] as MultiPolygonFeature).geometry.coordinates[1]).toHaveLength(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await click([4.895, 52.367]); await userEvent.selectOptions(parts, '1');
    expect(document.querySelector<HTMLElement>('#ring-control')!.hidden).toBe(true);
    await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
    await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: map.project([4.892, 52.367]), targetPosition: map.project([4.8915, 52.3665]) });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const lines = output().features[1] as MultiLineFeature;
    expect(lines.geometry.coordinates[0]).toEqual((original.features[1] as MultiLineFeature).geometry.coordinates[0]);
    expect(lines.geometry.coordinates[1]).not.toEqual((original.features[1] as MultiLineFeature).geometry.coordinates[1]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
  } finally { spy.mockRestore(); }
});
