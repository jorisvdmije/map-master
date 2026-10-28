import { expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import html from '../../examples/basic/index.html?raw';

it('selects corners with a box in the built demo, updates the controls and saves group movement with Undo', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
  document.querySelectorAll('script').forEach(script => { script.remove(); });
  await import('../../examples/basic/main.js');
  const polygon = page.getByRole('button', {name:'Polygon drawing', exact:true});
  await expect.element(polygon).toBeEnabled(); await polygon.click();
  await page.getByRole('button', {name:'Draw a polygon', exact:true}).click();
  const canvas = document.querySelector('canvas')!;
  for (const [x,y] of [[150,150],[400,150],[400,350],[150,350]]) {
    await userEvent.click(canvas, {position:{x:x!,y:y!}});
  }
  await page.getByRole('button', {name:'Finish', exact:true}).click();
  const output = document.querySelector<HTMLTextAreaElement>('#output')!; const saved = output.value;
  await expect.poll(async () => {
    await userEvent.click(canvas, {position:{x:250,y:250}});
    return document.querySelector<HTMLElement>('#selection')?.hidden;
  }).toBe(false);
  await page.getByRole('button', {name:'Edit vertices', exact:true}).click();
  await userEvent.keyboard('{Shift>}');
  await commands.vertexPointer('down',120,120); await commands.vertexPointer('up',430,180);
  await userEvent.keyboard('{/Shift}');
  await expect.element(page.getByText('2 of 4 corners selected.', {exact:true})).toBeVisible();
  await expect.element(page.getByRole('button', {name:'Remove selected vertices', exact:true})).toBeDisabled();
  expect(output.value).toBe(saved);
  await commands.vertexPointer('down',150,150); await commands.vertexPointer('up',170,130);
  expect(output.value).toBe(saved);
  await page.getByRole('button', {name:'Save', exact:true}).click(); const moved = output.value;
  expect(moved).not.toBe(saved);
  await page.getByRole('button', {name:'Undo', exact:true}).click(); expect(output.value).toBe(saved);
  await page.getByRole('button', {name:'Redo', exact:true}).click(); expect(output.value).toBe(moved);
});
