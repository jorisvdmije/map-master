import { expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import type { GeometryFeatureCollection } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';

it('selects a group in the built demo, moves/cancels the group, deletes once and restores with Undo', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  document.querySelectorAll('script').forEach((script) => { script.remove(); });
  await import('../../examples/basic/main.js');
  const polygon = page.getByRole('button', { name: 'Polygon drawing', exact: true });
  await expect.element(polygon).toBeEnabled(); await polygon.click();
  const canvas = document.querySelector('canvas')!;
  for (const offset of [0, 250]) {
    await page.getByRole('button', { name: 'Draw a polygon', exact: true }).click();
    for (const [x, y] of [[150, 150], [300, 150], [300, 300], [150, 300]]) {
      await userEvent.click(canvas, { position: { x: x! + offset, y: y! } });
    }
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
  }
  const output = document.querySelector<HTMLTextAreaElement>('#output')!;
  const saved = output.value;
  // Wait for the most recently committed shape to become available for picking.
  await expect.poll(async () => {
    await userEvent.click(canvas, { position: { x: 475, y: 225 } });
    return document.querySelector<HTMLElement>('#selection')?.hidden;
  }).toBe(false);
  await page.getByRole('button', { name: 'Deselect', exact: true }).click();
  await userEvent.keyboard('{Shift>}');
  await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: { x: 120, y: 120 }, targetPosition: { x: 580, y: 320 } });
  await userEvent.keyboard('{/Shift}');
  await expect.element(page.getByText('2 shapes selected', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Edit vertices', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Split polygon', exact: true })).toBeDisabled();
  expect(output.value).toBe(saved);
  await commands.vertexPointer('down', 225, 225); await commands.vertexPointer('move', 260, 270);
  await expect.poll(() => canvas.style.cursor).toBe('grabbing');
  expect(output.value).toBe(saved);
  await userEvent.keyboard('{Escape}'); await commands.vertexPointer('up', 260, 270);
  expect(output.value).toBe(saved);
  await expect.element(page.getByText('2 shapes selected', { exact: true })).toBeVisible();
  await userEvent.dragAndDrop(canvas, canvas, { sourcePosition: { x: 225, y: 225 }, targetPosition: { x: 260, y: 270 } });
  const moved = output.value; expect(moved).not.toBe(saved);
  expect((JSON.parse(moved) as GeometryFeatureCollection).features.map((feature) => feature.id))
    .toEqual((JSON.parse(saved) as GeometryFeatureCollection).features.map((feature) => feature.id));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output.value).toBe(saved);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output.value).toBe(moved);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output.value).toBe(saved);
  await page.getByRole('button', { name: 'Delete selected shapes', exact: true }).click();
  expect(document.querySelector('#feature-count')?.textContent).toBe('0 features');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output.value).toBe(saved);
  expect(document.querySelector<HTMLElement>('#selection')?.hidden).toBe(true);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(document.querySelector('#feature-count')?.textContent).toBe('0 features');
});
