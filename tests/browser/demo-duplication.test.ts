import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';

it('duplicates a group in the built demo, selects offset copies, moves them independently and undoes/redoes the batch', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  document.querySelectorAll('script').forEach((script) => { script.remove(); });
  await import('../../examples/basic/main.js');
  const polygon = page.getByRole('button', { name: 'Polygon drawing', exact: true });
  await expect.element(polygon).toBeEnabled(); await polygon.click();
  const canvas = document.querySelector('canvas')!;
  const output = document.querySelector<HTMLTextAreaElement>('#output')!;
  const collection = (): GeometryFeatureCollection => JSON.parse(output.value) as GeometryFeatureCollection;
  for (const offset of [0, 250]) {
    await page.getByRole('button', { name: 'Draw a polygon', exact: true }).click();
    expect(document.querySelector<HTMLButtonElement>('#duplicate-selected')!.disabled).toBe(true);
    for (const [x, y] of [[150, 150], [300, 150], [300, 300], [150, 300]]) {
      await userEvent.click(canvas, { position: { x: x! + offset, y: y! } });
    }
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
  }
  const before = collection();
  await expect.poll(async () => {
    await userEvent.click(canvas, { position: { x: 475, y: 225 } });
    return document.querySelector<HTMLElement>('#selection')!.hidden;
  }).toBe(false);
  await page.getByRole('button', { name: 'Deselect', exact: true }).click();
  await userEvent.keyboard('{Shift>}');
  await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: { x: 120, y: 120 }, targetPosition: { x: 580, y: 320 } });
  await userEvent.keyboard('{/Shift}');
  await page.getByRole('button', { name: 'Duplicate selected shapes', exact: true }).click();
  expect(document.activeElement).toBe(canvas);
  const copied = collection(); expect(copied.features).toHaveLength(4);
  expect(copied.features.slice(0, 2)).toEqual(before.features);
  expect(new Set(copied.features.map((feature) => feature.id)).size).toBe(4);
  for (const copy of copied.features.slice(2)) expect(before.features.map((feature) => feature.geometry)).not.toContainEqual(copy.geometry);
  await expect.element(page.getByText('2 shapes selected', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Edit vertices', exact: true })).toBeDisabled();
  await expect.element(page.getByText('Created 2 copies. Drag the selection to position it; Undo removes the copies.', { exact: true })).toBeVisible();
  // Wait until the new polygon can be picked, preserving its group selection on a plain click-free drag.
  await expect.poll(async () => {
    await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: { x: 315, y: 250 }, targetPosition: { x: 340, y: 280 } });
    return collection();
  }).not.toEqual(copied);
  expect(collection().features.slice(0, 2)).toEqual(before.features);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(collection()).toEqual(copied);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(collection()).toEqual(before);
  expect(document.querySelector<HTMLElement>('#selection')!.hidden).toBe(true);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(collection()).toEqual(copied);
  // Copying a single polygon uses the same command; editing protects active drafts.
  await expect.poll(async () => {
    await userEvent.click(canvas, { position: { x: 315, y: 250 } });
    return document.querySelector<HTMLElement>('#selection')!.hidden;
  }).toBe(false);
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Duplicate selected shape', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate selected shape', exact: true }).click();
  expect(collection().features).toHaveLength(5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(collection()).toEqual(copied);
});
