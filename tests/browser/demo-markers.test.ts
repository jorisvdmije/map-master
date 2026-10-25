import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import html from '../../examples/basic/index.html?raw';
import type { GeometryFeatureCollection } from '../../src/index.js';

it('places, selects, edits and undoes a marker through the playground controls', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  document.querySelectorAll('script').forEach(script => { script.remove(); });
  await import('../../examples/basic/main.js');
  const marker = page.getByRole('button', { name: 'Marker placement', exact: true });
  await expect.element(marker).toBeEnabled(); await marker.click();
  await page.getByRole('button', { name: 'Place a marker', exact: true }).click();
  const canvas = document.querySelector('canvas')!;
  await userEvent.click(canvas, { position: { x: 250, y: 200 } });
  const output = document.querySelector<HTMLTextAreaElement>('#output')!;
  const saved = output.value;
  expect((JSON.parse(saved) as GeometryFeatureCollection).features[0]?.geometry.type).toBe('Point');
  await expect.poll(async () => {
    await userEvent.click(canvas, { position: { x: 250, y: 200 } });
    return document.querySelector<HTMLButtonElement>('#edit-selected')!.disabled;
  }).toBe(false);
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Remove vertex', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(output.value).toBe(saved);
  await page.getByRole('button', { name: 'Delete selected shape', exact: true }).click();
  expect((JSON.parse(output.value) as GeometryFeatureCollection).features).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output.value).toBe(saved);
});
