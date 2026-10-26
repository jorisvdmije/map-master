import { expect, it } from 'vitest';
import { page } from 'vitest/browser';
import html from '../../examples/basic/index.html?raw';

it('demonstrates automatic/custom stripes and stores selected colors with one Undo', async () => {
  history.replaceState(null, '', `${location.pathname}?basemap=off`);
  const documentHTML = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = documentHTML.body.innerHTML; document.querySelectorAll('script').forEach(script => { script.remove(); });
  await import('../../examples/basic/main.js');
  await expect.element(page.getByLabelText('Map colors', { exact: true })).toBeEnabled();
  await page.getByText('Object colors & overlap', { exact: true }).click();
  await page.getByRole('button', { name: 'Add overlap example', exact: true }).click();
  const output = () => document.querySelector<HTMLTextAreaElement>('#output')!.value;
  const original = output(); const parsed = JSON.parse(original) as { features: { properties: { demoColor: string; demoOrder: number } }[] };
  expect(parsed.features).toHaveLength(3); expect(new Set(parsed.features.map(feature => feature.properties.demoColor)).size).toBe(3);
  await page.getByLabelText('Overlap style', { exact: true }).selectOptions('custom');
  await expect.element(page.getByLabelText('First stripe color', { exact: true })).toBeVisible();
  expect(output()).toBe(original);
  await page.getByLabelText('Drawing order', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Apply color & order', exact: true }).click();
  expect(output()).not.toBe(original);
  const updated = JSON.parse(output()) as typeof parsed;
  expect(updated.features.every(feature => feature.properties.demoOrder === 10)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toBe(original);
  await page.getByRole('button', { name: 'Lock selection', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Apply color & order', exact: true })).toBeDisabled();
  await page.getByLabelText('Overlap style', { exact: true }).selectOptions('off'); expect(output()).toBe(original);
});
