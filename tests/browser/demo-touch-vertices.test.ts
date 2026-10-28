import { expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import html from '../../examples/basic/index.html?raw';

it('previews touch vertex editing, cancels, and saves with one Undo through demo controls', async () => {
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
  // Wait for worker-rendered geometry to become pickable before entering edit.
  await expect.poll(async () => { await userEvent.click(canvas, { position: { x: 250, y: 250 } }); return document.querySelector<HTMLElement>('#selection')?.hidden; }, { timeout: 5000 }).toBe(false);
  const drag = async () => {
    await commands.touchContact('start', [{ id: 1, x: 168, y: 150 }]);
    await commands.touchContact('move', [{ id: 1, x: 198, y: 180 }]);
    await commands.touchContact('end', []);
  };
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click();
  await drag(); expect(output.value).toBe(original);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output.value).toBe(original);
  await page.getByRole('button', { name: 'Edit vertices', exact: true }).click(); await drag();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = output.value; expect(saved).not.toBe(original);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output.value).toBe(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output.value).toBe(saved);
});
