import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Coordinate, GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';
import fixture from '../../examples/basic/public/reshape.geojson?raw';

it('imports the reshape example, chooses either boundary, cancels, applies and restores the original via Undo', async () => {
  const spy = vi.spyOn(Map.prototype, 'fitBounds'); let map: Map | undefined;
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach((script) => { script.remove(); });
    await import('../../examples/basic/main.js');
    const input = page.getByLabelText('Import GeoJSON'); await expect.element(input).toBeEnabled();
    await input.upload(new File([fixture], 'reshape.geojson', { type: 'application/geo+json' }));
    await expect.poll(() => spy.mock.contexts[0]).toBeDefined(); const instance = spy.mock.contexts[0];
    if (!(instance instanceof Map)) throw new Error('Expected map fit after import.'); map = instance;
    const canvas = document.querySelector('canvas')!;
    const output = (): GeometryFeatureCollection => JSON.parse(document.querySelector<HTMLTextAreaElement>('#output')!.value) as GeometryFeatureCollection;
    const original = output();
    const click = (coordinate: Coordinate) => userEvent.click(canvas, { position: instance.project(coordinate) });
    const fillId = Object.keys(instance.getStyle().sources).find((id) => id.endsWith('-features'))!.replace(/-features$/, '-fill');
    await expect.poll(() => instance.queryRenderedFeatures(instance.project([4.888, 52.373]), { layers: [fillId] }).length).toBeGreaterThan(0);
    await click([4.888, 52.373]); const reshape = page.getByRole('button', { name: 'Reshape polygon', exact: true });
    await expect.element(reshape).toBeEnabled(); await reshape.click();
    const apply = page.getByRole('button', { name: 'Apply reshape', exact: true });
    await expect.element(apply).toBeDisabled(); await expect.element(input).toBeDisabled();
    await click([4.888, 52.370]); await click([4.890, 52.3715]); await click([4.892, 52.370]);
    await expect.element(apply).toBeEnabled(); expect(output()).toEqual(original);
    const other = page.getByRole('button', { name: 'Other boundary', exact: true });
    await other.click(); await expect.element(other).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByText('Replacing the longer old boundary.', { exact: false })).toBeVisible();
    await other.click(); await expect.element(other).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output()).toEqual(original);
    await reshape.click(); await click([4.888, 52.370]); await click([4.890, 52.3715]); await click([4.892, 52.370]);
    await apply.click(); const after = output(); expect(after.features).toHaveLength(1);
    expect(after.features[0]).toMatchObject({ id: 'garden', properties: original.features[0]!.properties });
    expect(after.features[0]!.geometry).not.toEqual(original.features[0]!.geometry);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(after);
  } finally { map?.remove(); spy.mockRestore(); }
});
