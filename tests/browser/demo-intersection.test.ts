import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Coordinate, GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';
import fixture from '../../examples/basic/public/intersection.geojson?raw';

it('imports the intersection example, previews/cancels/intersects through demo controls and restores originals with Undo', async () => {
  const spy = vi.spyOn(Map.prototype, 'fitBounds');
  let map: Map | undefined;
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach((script) => { script.remove(); });
    await import('../../examples/basic/main.js');
    const input = page.getByLabelText('Import GeoJSON'); await expect.element(input).toBeEnabled();
    await input.upload(new File([fixture], 'intersection.geojson', { type: 'application/geo+json' }));
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
    const intersect = page.getByRole('button', { name: 'Intersect polygons', exact: true });
    await expect.element(intersect).toBeDisabled();
    await userEvent.keyboard('{Shift>}'); await click([4.899, 52.379]); await click([4.897, 52.369]); await userEvent.keyboard('{/Shift}');
    await expect.element(intersect).toBeEnabled(); await intersect.click();
    await expect.element(page.getByRole('button', { name: 'Apply intersection', exact: true })).toBeEnabled();
    expect(output()).toEqual(original); await expect.element(input).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output()).toEqual(original);
    await intersect.click(); await page.getByRole('button', { name: 'Apply intersection', exact: true }).click();
    const intersected = output(); expect(intersected.features).toHaveLength(1);
    expect(intersected.features[0]).toMatchObject({ id: 'west', properties: original.features[0]!.properties, geometry: { type: 'Polygon' } });
    expect(intersected.features[0]!.geometry.coordinates).toHaveLength(1);
    expect(intersected.features[0]!.geometry).toEqual({ type: 'Polygon', coordinates: [[[4.892, 52.373], [4.895, 52.373], [4.895, 52.375], [4.892, 52.375], [4.892, 52.373]]] });
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(intersected);

    // Empty output must be explained before applying; unrelated data must survive.
    await page.getByRole('button', { name: 'Deselect', exact: true }).click();
    const disjoint: GeometryFeatureCollection = { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'empty-west', properties: null, geometry: { type: 'Polygon',
        coordinates: [[[4.886, 52.370], [4.890, 52.370], [4.890, 52.374], [4.886, 52.374], [4.886, 52.370]]] } },
      { type: 'Feature', id: 'empty-east', properties: null, geometry: { type: 'Polygon',
        coordinates: [[[4.896, 52.376], [4.900, 52.376], [4.900, 52.380], [4.896, 52.380], [4.896, 52.376]]] } },
    ] };
    await input.upload(new File([JSON.stringify(disjoint)], 'disjoint.geojson', { type: 'application/geo+json' }));
    await expect.poll(() => output().features.length).toBe(3);
    await expect.poll(() => instance.queryRenderedFeatures(instance.project([4.887, 52.371]), { layers: [fillId] }).length).toBeGreaterThan(0);
    await click([4.887, 52.371]); await userEvent.keyboard('{Shift>}'); await click([4.899, 52.379]); await userEvent.keyboard('{/Shift}');
    const beforeEmpty = output(); await intersect.click();
    await expect.element(page.getByText('No common area remains. Apply intersection deletes all selected shapes. Undo restores them.', { exact: true })).toBeVisible();
    await expect.element(page.getByText('No common area. All selected shapes are removed on apply.', { exact: true })).toBeVisible();
    expect(output()).toEqual(beforeEmpty);
    await page.getByRole('button', { name: 'Apply intersection', exact: true }).click(); expect(output()).toEqual(intersected);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(beforeEmpty);

  } finally { map?.remove(); spy.mockRestore(); }
});
