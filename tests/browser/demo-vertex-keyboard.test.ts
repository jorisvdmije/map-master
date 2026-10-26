import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import html from '../../examples/basic/index.html?raw';

it('edits a polygon with keyboard focus/group selection, cancellation and one saved Undo', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML; document.querySelectorAll('script').forEach(script => { script.remove(); });
  await import('../../examples/basic/main.js');
  const polygon = page.getByRole('button', { name: 'Polygon drawing', exact: true });
  await expect.element(polygon).toBeEnabled(); await polygon.click();
  await page.getByRole('button', { name: 'Draw a polygon', exact: true }).click();
  const canvas = document.querySelector('canvas')!;
  for (const [x, y] of [[150, 150], [400, 150], [400, 350], [150, 350]]) await userEvent.click(canvas, { position: { x: x!, y: y! } });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  const output = document.querySelector<HTMLTextAreaElement>('#output')!; const original = output.value;
  await expect.poll(async () => { await userEvent.click(canvas, { position: { x: 250, y: 250 } }); return document.querySelector<HTMLElement>('#selection')?.hidden; }).toBe(false);
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await userEvent.keyboard('{Home} {PageDown}{Shift>} {ArrowRight}{/Shift}');
  expect(document.activeElement).toBe(document.querySelector('[data-geo-vertex-focus]'));
  await expect.element(page.getByText('2 of 4 corners selected.', { exact: true })).toBeVisible();
  expect(output.value).toBe(original); await userEvent.keyboard('{Enter}'); const saved = output.value; expect(saved).not.toBe(original);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output.value).toBe(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output.value).toBe(saved);
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await userEvent.keyboard('{Home}{ArrowDown}{Escape}'); expect(output.value).toBe(saved);
  expect(document.querySelector('[data-geo-vertex-focus]')).toBeNull();
});
