import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Coordinate, GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';
import fixture from '../../examples/basic/public/shared-boundary.geojson?raw';
it('rotates a pair with numeric and step controls, cancels, confirms and restores exact GeoJSON with Undo/Redo', async () => {
  const spy = vi.spyOn(Map.prototype, 'fitBounds'); let map: Map | undefined;
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach((script) => { script.remove(); });
    await import('../../examples/basic/main.js');
    const input = page.getByLabelText('Import GeoJSON'); await expect.element(input).toBeEnabled();
    await input.upload(new File([fixture], 'parcels.geojson', { type: 'application/geo+json' }));
    await expect.poll(() => spy.mock.contexts[0]).toBeDefined(); const instance = spy.mock.contexts[0];
    if (!(instance instanceof Map)) throw new Error('Expected imported map'); map = instance;
    const canvas = document.querySelector('canvas')!;
    const output = (): GeometryFeatureCollection => JSON.parse(document.querySelector<HTMLTextAreaElement>('#output')!.value) as GeometryFeatureCollection;
    const original = output(); const click = (coordinate: Coordinate) => userEvent.click(canvas, { position: instance.project(coordinate) });
    const fillId = Object.keys(instance.getStyle().sources).find((id) => id.endsWith('-features'))!.replace(/-features$/, '-fill');
    await expect.poll(() => instance.queryRenderedFeatures(instance.project([4.888, 52.372]), { layers: [fillId] }).length).toBeGreaterThan(0);
    await click([4.888, 52.372]); await userEvent.keyboard('{Shift>}'); await click([4.892, 52.372]); await userEvent.keyboard('{/Shift}');
    const rotate = page.getByRole('button', { name: 'Rotate selection', exact: true }); await rotate.click();
    const angle = page.getByLabelText('Angle (degrees clockwise)'); await expect.element(angle).toBeVisible();
    const apply = page.getByRole('button', { name: 'Apply rotation', exact: true });
    await angle.fill('30'); await expect.element(apply).toBeEnabled(); expect(output()).toEqual(original);
    await expect.element(input).toBeDisabled(); await expect.element(rotate).toBeDisabled();
    await angle.fill(''); await expect.element(apply).toBeDisabled();
    await page.getByRole('button', { name: '+15°', exact: true }).click(); await expect.element(angle).toHaveValue(45);
    await page.getByRole('button', { name: '−15°', exact: true }).click(); await expect.element(angle).toHaveValue(30);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output()).toEqual(original);
    await rotate.click(); await expect.element(angle).toHaveValue(0);
    await angle.fill('-45'); await apply.click(); const after = output();
    expect(after.features.map((f) => f.id)).toEqual(original.features.map((f) => f.id));
    for (let i = 0; i < 2; i++) { expect(after.features[i]!.geometry).not.toEqual(original.features[i]!.geometry); expect(after.features[i]!.properties).toEqual(original.features[i]!.properties); }
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(after);
    await rotate.click(); await angle.fill('360'); await apply.click(); expect(output()).toEqual(after);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original); // Full turn added no history entry.
  } finally { map?.remove(); spy.mockRestore(); }
});
