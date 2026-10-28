import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Coordinate, GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';
import fixture from '../../examples/basic/public/difference.geojson?raw';

it('imports the difference example, previews/cancels/subtracts through demo controls and restores originals with Undo', async () => {
  const spy = vi.spyOn(Map.prototype, 'fitBounds');
  let map: Map | undefined;
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach((script) => { script.remove(); });
    await import('../../examples/basic/main.js');
    const input = page.getByLabelText('Import GeoJSON'); await expect.element(input).toBeEnabled();
    await input.upload(new File([fixture], 'difference.geojson', { type: 'application/geo+json' }));
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
    const subtract = page.getByRole('button', { name: 'Subtract polygons', exact: true });
    await expect.element(subtract).toBeDisabled();
    await userEvent.keyboard('{Shift>}'); await click([4.899, 52.379]); await userEvent.keyboard('{/Shift}');
    await expect.element(subtract).toBeEnabled(); await subtract.click();
    await expect.element(page.getByRole('button', { name: 'Apply subtraction', exact: true })).toBeEnabled();
    expect(output()).toEqual(original); await expect.element(input).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output()).toEqual(original);
    await subtract.click(); await page.getByRole('button', { name: 'Apply subtraction', exact: true }).click();
    const subtracted = output(); expect(subtracted.features).toHaveLength(2);
    expect(subtracted.features[0]).toMatchObject({ id: 'target', properties: original.features[0]!.properties, geometry: { type: 'Polygon' } });
    expect(subtracted.features[1]).toEqual(original.features[1]);
    expect(subtracted.features[0]!.geometry).not.toEqual(original.features[0]!.geometry);
    expect(subtracted.features[0]!.geometry.coordinates).toHaveLength(2); // Surviving hole.
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(subtracted);
  } finally { map?.remove(); spy.mockRestore(); }
});
