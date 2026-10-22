import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Coordinate, GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';
import fixture from '../../examples/basic/public/union.geojson?raw';

it('imports the union example, previews/cancels/merges through demo controls and restores originals with Undo', async () => {
  const spy = vi.spyOn(Map.prototype, 'fitBounds');
  let map: Map | undefined;
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach((script) => { script.remove(); });
    await import('../../examples/basic/main.js');
    const input = page.getByLabelText('Import GeoJSON'); await expect.element(input).toBeEnabled();
    await input.upload(new File([fixture], 'union.geojson', { type: 'application/geo+json' }));
    await expect.poll(() => spy.mock.contexts[0]).toBeDefined();
    const instance = spy.mock.contexts[0];
    if (!(instance instanceof Map)) throw new Error('Expected map fit after import.');
    map = instance;
    const canvas = document.querySelector('canvas')!;
    const output = (): GeometryFeatureCollection => JSON.parse(document.querySelector<HTMLTextAreaElement>('#output')!.value) as GeometryFeatureCollection;
    const original = output();
    const click = (coordinate: Coordinate) => userEvent.click(canvas, { position: instance.project(coordinate) });
    const fillId = Object.keys(instance.getStyle().sources).find((id) => id.endsWith('-features'))!.replace(/-features$/, '-fill');
    await expect.poll(() => instance.queryRenderedFeatures(instance.project([4.887, 52.371]), { layers: [fillId] }).length).toBeGreaterThan(0);
    await click([4.887, 52.371]);
    const merge = page.getByRole('button', { name: 'Merge polygons', exact: true });
    await expect.element(merge).toBeDisabled();
    await userEvent.keyboard('{Shift>}'); await click([4.899, 52.379]); await userEvent.keyboard('{/Shift}');
    await expect.element(merge).toBeEnabled(); await merge.click();
    await expect.element(page.getByRole('button', { name: 'Apply merge', exact: true })).toBeEnabled();
    expect(output()).toEqual(original); await expect.element(input).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output()).toEqual(original);
    await merge.click(); await page.getByRole('button', { name: 'Apply merge', exact: true }).click();
    const merged = output(); expect(merged.features).toHaveLength(1);
    expect(merged.features[0]).toMatchObject({ id: 'west', properties: original.features[0]!.properties, geometry: { type: 'Polygon' } });
    expect(merged.features[0]!.geometry.coordinates).toHaveLength(2); // Surviving hole.
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(merged);
  } finally { map?.remove(); spy.mockRestore(); }
});
