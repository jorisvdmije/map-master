import { Map } from 'maplibre-gl';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { GeometryFeatureCollection, PolygonFeature } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';

let map: Map | undefined;
afterEach(() => { map?.remove(); map = undefined; vi.restoreAllMocks(); });

it('creates, edits and deletes a hole in the demo, preserving the polygon with undo/redo', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  document.querySelectorAll('script').forEach((script) => { script.remove(); });
  const sourceSpy = vi.spyOn(Map.prototype, 'addSource');
  await import('../../examples/basic/main.js');
  await expect.element(page.getByRole('button', { name: 'Polygon drawing', exact: true })).toBeEnabled();
  const instance = sourceSpy.mock.contexts[0];
  if (!(instance instanceof Map)) throw new Error('Expected a mounted demo map.');
  map = instance;
  await page.getByRole('button', { name: 'Polygon drawing', exact: true }).click();
  await page.getByRole('button', { name: 'Draw a polygon', exact: true }).click();
  const canvas = document.querySelector('canvas')!;
  const saved = (): PolygonFeature => (JSON.parse(document.querySelector<HTMLTextAreaElement>('#output')!.value) as GeometryFeatureCollection).features[0] as PolygonFeature;
  for (const [x, y] of [[80, 80], [500, 80], [500, 450], [80, 450]]) await userEvent.click(canvas, { position: { x: x!, y: y! } });
  await page.getByRole('button', { name: 'Finish', exact: true }).click(); const before = saved();
  // Picking depends on worker-built tiles; wait for the shape before clicking.
  const fillId = instance.getStyle().layers.find(layer => layer.id.endsWith('-fill'))!.id;
  await expect.poll(() => instance.queryRenderedFeatures([110,110], {layers:[fillId]}).length).toBeGreaterThan(0);
  await userEvent.click(canvas, { position: { x: 110, y: 110 } });
  await expect.poll(() => document.querySelector<HTMLElement>('#selection')!.hidden).toBe(false);
  await page.getByRole('button', { name: 'Draw a hole', exact: true }).click();
  for (const [x, y] of [[180, 180], [300, 180], [300, 300], [180, 300]]) await userEvent.click(canvas, { position: { x: x!, y: y! } });
  await userEvent.keyboard('{Enter}'); const withHole = saved();
  expect(withHole.geometry.coordinates).toHaveLength(2); expect(withHole.id).toBe(before.id);
  await userEvent.selectOptions(page.getByRole('combobox', { name: 'Ring to edit' }), '1');
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Draw a hole', exact: true })).toBeDisabled();
  await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: { x: 180, y: 180 }, targetPosition: { x: 160, y: 160 } });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(saved().geometry.coordinates[0]).toEqual(before.geometry.coordinates[0]); expect(saved()).not.toEqual(withHole);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(saved()).toEqual(withHole);
  await page.getByRole('button', { name: 'Delete hole', exact: true }).click(); expect(saved()).toEqual(before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(saved()).toEqual(withHole);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(saved()).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(saved()).toEqual(withHole);
});
