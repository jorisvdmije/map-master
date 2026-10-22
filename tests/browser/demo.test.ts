import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import html from '../../examples/basic/index.html?raw';
import type { GeometryFeatureCollection } from '../../src/index.js';

it('runs the demo with its real controls and a built package, without a tile service', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  const documentHTML = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = documentHTML.body.innerHTML;
  document.querySelectorAll('script').forEach((script) => { script.remove(); });
  await import('../../examples/basic/main.js');
  const start = page.getByRole('button', { name: 'Draw a line' });
  await expect.element(start).toBeEnabled();
  await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  await start.click();
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('Demo did not create a map canvas.');
  await userEvent.click(canvas, { position: { x: 200, y: 180 } });
  await expect.element(page.getByRole('button', { name: 'Finish' })).toBeDisabled();
  await userEvent.click(canvas, { position: { x: 310, y: 280 } });
  await userEvent.click(canvas, { position: { x: 440, y: 220 } });
  await page.getByRole('button', { name: 'Finish' }).click();
  const output = document.querySelector<HTMLTextAreaElement>('#output');
  expect(output?.value).toContain('LineString');
  let saved = output?.value;
  const snapping = page.getByRole('checkbox', { name: 'Snap to vertices & edges' });
  await expect.element(snapping).toBeChecked();
  await start.click();
  await userEvent.hover(canvas, { position: { x: 208, y: 185 } });
  await expect.poll(() => document.querySelector('#snap-status')?.textContent).toBe('Snapped to vertex');
  await userEvent.keyboard('{Alt>}');
  await expect.poll(() => document.querySelector('#snap-status')?.textContent).toContain('Draw near');
  await userEvent.keyboard('{/Alt}');
  await expect.poll(() => document.querySelector('#snap-status')?.textContent).toBe('Snapped to vertex');
  await snapping.click();
  await expect.poll(() => document.querySelector('#snap-status')?.textContent).toBe('Snapping is off.');
  await snapping.click();
  await userEvent.hover(canvas, { position: { x: 208, y: 185 } });
  await expect.poll(() => document.querySelector('#snap-status')?.textContent).toBe('Snapped to vertex');
  await userEvent.click(canvas, { position: { x: 130, y: 200 } });
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(output?.value).toBe(saved);

  await page.getByRole('button', { name: 'Polygon drawing' }).click();
  await page.getByRole('button', { name: 'Draw a polygon' }).click();
  await expect.element(page.getByRole('button', { name: 'Line drawing' })).toBeDisabled();
  await userEvent.click(canvas, { position: { x: 150, y: 150 } });
  await userEvent.click(canvas, { position: { x: 350, y: 150 } });
  await userEvent.click(canvas, { position: { x: 250, y: 350 } });
  await page.getByRole('button', { name: 'Finish' }).click();
  expect(output?.value).toContain('Polygon');
  expect(output?.value).toContain('LineString');
  saved = output?.value;

  // Select a polygon interior away from the existing line, then use the UI to clear it.
  await expect.poll(async () => {
    await userEvent.click(canvas, { position: { x: 260, y: 175 } });
    return document.querySelector<HTMLElement>('#selection')?.hidden;
  }).toBe(false);
  expect(document.querySelector('#selection-type')?.textContent).toBe('Polygon');
  expect(output?.value).toBe(saved);
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Draw a polygon' })).toBeDisabled();
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 150, y: 150 }, targetPosition: { x: 130, y: 130 },
  });
  expect(output?.value).toBe(saved);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(output?.value).toBe(saved);
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 150, y: 150 }, targetPosition: { x: 130, y: 130 },
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(output?.value).not.toBe(saved);
  saved = output?.value;
  await page.getByRole('button', { name: 'Deselect', exact: true }).click();
  expect(document.querySelector<HTMLElement>('#selection')?.hidden).toBe(true);

  await page.getByRole('button', { name: 'Draw a polygon' }).click();
  await userEvent.click(canvas, { position: { x: 150, y: 150 } });
  await userEvent.click(canvas, { position: { x: 350, y: 350 } });
  await userEvent.click(canvas, { position: { x: 150, y: 350 } });
  await userEvent.click(canvas, { position: { x: 350, y: 150 } });
  await expect.element(page.getByRole('button', { name: 'Finish' })).toBeDisabled();
  expect(document.querySelector('#status')?.textContent).toContain('cannot cross');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(output?.value).toBe(saved);

  // Inspect the actual download payload; avoid leaving a download in the test runner.
  const mixed = JSON.parse(saved ?? '{}') as GeometryFeatureCollection;
  await expect.poll(async () => {
    await userEvent.click(canvas, { position: { x: 260, y: 175 } });
    return document.querySelector<HTMLElement>('#selection')?.hidden;
  }).toBe(false);
  await page.getByRole('button', { name: 'Delete selected shape', exact: true }).click();
  expect(document.querySelector<HTMLElement>('#selection')?.hidden).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('#start'));
  expect(document.querySelector('#feature-count')?.textContent).toBe('1 feature');
  expect(output?.value).toBe(JSON.stringify({ type: 'FeatureCollection', features: [mixed.features[0]] }, null, 2));
  saved = output?.value;

  const createURL = vi.spyOn(URL, 'createObjectURL');
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await page.getByRole('button', { name: 'Export GeoJSON' }).click();
  const blob = createURL.mock.calls.at(-1)?.[0];
  expect(blob).toBeInstanceOf(Blob);
  if (!(blob instanceof Blob)) throw new Error('Export did not produce a Blob.');
  expect(blob.type).toBe('application/geo+json');
  expect(await blob.text()).toBe(saved);
  expect(anchorClick).toHaveBeenCalledOnce();
  createURL.mockRestore();
  anchorClick.mockRestore();

  await expect.poll(async () => {
    await userEvent.click(canvas, { position: { x: 200, y: 180 } });
    return document.querySelector<HTMLElement>('#selection')?.hidden;
  }).toBe(false);
  await userEvent.keyboard('{Delete}');
  await expect.element(page.getByRole('button', { name: 'Export GeoJSON' })).toBeDisabled();
  expect(document.querySelector('#feature-count')?.textContent).toBe('0 features');
  expect(output?.value).toBe(JSON.stringify({ type: 'FeatureCollection', features: [] }, null, 2));

  const input = page.getByLabelText('Import GeoJSON', { exact: true });
  const imported = { type: 'FeatureCollection', features: mixed.features.map((feature, index) => ({
    ...feature, id: index === 0 ? 0 : '0', properties: index === 0 ? { name: 'Imported line', nested: { tag: true } } : null,
  })) };
  await input.upload(new File([JSON.stringify(imported)], 'shapes.geojson', { type: 'application/geo+json' }));
  await expect.element(page.getByText('Imported 2 features.', { exact: true })).toBeVisible();
  expect(output?.value).toBe(JSON.stringify(imported, null, 2));
  expect(document.querySelector('#feature-count')?.textContent).toBe('2 features');
  const importedOutput = output?.value;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(document.querySelector('#feature-count')?.textContent).toBe('0 features');
  expect(document.activeElement).toBe(canvas);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(output?.value).toBe(importedOutput);
  await input.upload(new File([JSON.stringify(imported)], 'shapes.geojson', { type: 'application/geo+json' }));
  await expect.poll(() => document.querySelector('#import-status')?.textContent).toContain('already exists');
  expect(output?.value).toBe(importedOutput);
  await input.upload(new File(['{broken'], 'broken.json', { type: 'application/json' }));
  await expect.element(page.getByText('The file is not valid JSON.', { exact: true })).toBeVisible();
  expect(output?.value).toBe(importedOutput);
  await page.getByRole('button', { name: 'Draw a polygon' }).click();
  await expect.element(input).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.element(input).toBeEnabled();
});
