import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Coordinate, GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';
import fixture from '../../examples/basic/public/shared-boundary.geojson?raw';
it('selects adjoining parcels, previews a shared edit, cancels, saves both and restores both via Undo', async () => {
  const spy = vi.spyOn(Map.prototype, 'fitBounds'); let map: Map | undefined;
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach((script) => { script.remove(); });
    await import('../../examples/basic/main.js');
    const input = page.getByLabelText('Import GeoJSON'); await expect.element(input).toBeEnabled();
    await input.upload(new File([fixture], 'shared-boundary.geojson', { type: 'application/geo+json' }));
    await expect.poll(() => spy.mock.contexts[0]).toBeDefined(); const instance = spy.mock.contexts[0];
    if (!(instance instanceof Map)) throw new Error('Expected map after import.'); map = instance;
    const canvas = document.querySelector('canvas')!;
    const output = (): GeometryFeatureCollection => JSON.parse(document.querySelector<HTMLTextAreaElement>('#output')!.value) as GeometryFeatureCollection;
    const original = output(); const click = (coordinate: Coordinate) => userEvent.click(canvas, { position: instance.project(coordinate) });
    const fillId = Object.keys(instance.getStyle().sources).find((id) => id.endsWith('-features'))!.replace(/-features$/, '-fill');
    await expect.poll(() => instance.queryRenderedFeatures(instance.project([4.888, 52.372]), { layers: [fillId] }).length).toBeGreaterThan(0);
    await click([4.888, 52.372]); await userEvent.keyboard('{Shift>}'); await click([4.892, 52.372]); await userEvent.keyboard('{/Shift}');
    const edit = page.getByRole('button', { name: 'Edit shared boundary', exact: true }); await expect.element(edit).toBeEnabled(); await edit.click();
    const save = page.getByRole('button', { name: 'Save both polygons', exact: true }); await expect.element(save).toBeEnabled(); await expect.element(input).toBeDisabled();
    const start = instance.project([4.890, 52.370]); const end = instance.project([4.890, 52.375]);
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const destination = instance.project([4.891, 52.3725]);
    const drag = () => userEvent.dragAndDrop(canvas, canvas, { sourcePosition: midpoint, targetPosition: destination });
    await drag(); expect(output()).toEqual(original);
    await expect.element(page.getByText('Grey endpoints stay fixed.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output()).toEqual(original);
    await edit.click(); await drag(); await save.click(); const after = output();
    expect(after.features.map((feature) => feature.id)).toEqual(['west', 'east']);
    for (let i = 0; i < 2; i++) {
      expect(after.features[i]!.geometry).not.toEqual(original.features[i]!.geometry);
      expect(after.features[i]!.properties).toEqual(original.features[i]!.properties);
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(after);
  } finally { map?.remove(); spy.mockRestore(); }
});
