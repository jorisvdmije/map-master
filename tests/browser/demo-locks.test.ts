import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import html from '../../examples/basic/index.html?raw';

it('exposes session locks, disables mutations and restores commands after unlocking in the playground', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  const documentHTML = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = documentHTML.body.innerHTML;
  document.querySelectorAll('script').forEach((script) => { script.remove(); });
  await import('../../examples/basic/main.js');
  const draw = page.getByRole('button', { name: 'Draw a line' });
  await expect.element(draw).toBeEnabled(); await draw.click();
  const canvas = document.querySelector('canvas')!;
  await userEvent.click(canvas, { position: { x: 180, y: 180 } });
  await userEvent.click(canvas, { position: { x: 350, y: 230 } });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  const output = document.querySelector<HTMLTextAreaElement>('#output')!; const before = output.value;
  // New drawings are not selected automatically.
  await expect.poll(async () => {
    await userEvent.click(canvas, { position: { x: 265, y: 205 } });
    return document.querySelector<HTMLButtonElement>('#lock-selected')!.disabled;
  }).toBe(false);
  await page.getByRole('button', { name: 'Lock selection', exact: true }).click();
  for (const id of ['edit-selected', 'delete-selected', 'offset-selected', 'buffer-selected', 'simplify-selected', 'scale-selected', 'rotate-selected', 'undo']) {
    expect(document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled).toBe(true);
  }
  await expect.element(page.getByRole('button', { name: 'Duplicate selected shape', exact: true })).toBeEnabled();
  canvas.focus(); await userEvent.keyboard('{Delete}'); expect(output.value).toBe(before);
  await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Edit vertices', exact: true })).toBeEnabled();
  await expect.element(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  expect(output.value).toBe(before);
});
