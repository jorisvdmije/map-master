import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Coordinate, GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';
import fixture from '../../examples/basic/public/shared-boundary.geojson?raw';
it('scales a pair with numeric and step controls, cancels, confirms and restores exact GeoJSON with Undo/Redo', async () => {
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
    const scale = page.getByRole('button', { name: 'Scale selection', exact: true }); await scale.click();
    const factor = page.getByLabelText('Scale factor'); await expect.element(factor).toBeVisible();
    const apply = page.getByRole('button', { name: 'Apply scale', exact: true });
    await factor.fill('1.5'); await expect.element(apply).toBeEnabled(); expect(output()).toEqual(original);
    await expect.element(input).toBeDisabled(); await expect.element(scale).toBeDisabled();
    await factor.fill('0'); await expect.element(apply).toBeDisabled();
    await factor.fill('-1'); await expect.element(apply).toBeDisabled();
    await factor.fill(''); await expect.element(apply).toBeDisabled();
    await page.getByRole('button', { name: 'Double size', exact: true }).click(); await expect.element(factor).toHaveValue(3);
    await page.getByRole('button', { name: 'Half size', exact: true }).click(); await expect.element(factor).toHaveValue(1.5);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output()).toEqual(original);
    await scale.click(); await expect.element(factor).toHaveValue(1);
    await factor.fill('0.5'); await apply.click(); const after = output();
    expect(after.features.map((f) => f.id)).toEqual(original.features.map((f) => f.id));
    for (let i = 0; i < 2; i++) { expect(after.features[i]!.geometry).not.toEqual(original.features[i]!.geometry); expect(after.features[i]!.properties).toEqual(original.features[i]!.properties); }
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(after);
    await scale.click(); await factor.fill('1'); await apply.click(); expect(output()).toEqual(after);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original); // Identity scale added no history entry.
    await scale.click();
    const horizontal = page.getByLabelText('Horizontal scale factor'); const vertical = page.getByLabelText('Vertical scale factor');
    await horizontal.fill('2'); await vertical.fill('0.5'); await expect.element(factor).toHaveValue(null);
    await expect.element(apply).toBeEnabled();
    await page.getByRole('button', { name: 'Double size', exact: true }).click();
    await expect.element(horizontal).toHaveValue(4); await expect.element(vertical).toHaveValue(1);
    await vertical.fill('0'); await expect.element(apply).toBeDisabled();
    await vertical.fill('0.5'); await apply.click(); const stretched = output();
    for (let i = 0; i < 2; i++) expect(stretched.features[i]!.geometry).not.toEqual(original.features[i]!.geometry);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);

  } finally { map?.remove(); spy.mockRestore(); }
});
