import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { GeometryFeatureCollection, LineFeature } from '../../src/index.js';
import html from '../../examples/basic/index.html?raw';

it('draws with the demo angle controls and saves, undoes, redoes and cancels through the public API', async () => {
  const spy = vi.spyOn(Map.prototype, 'getCanvas'); let map: Map | undefined;
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach(script => { script.remove(); });
    await import('../../examples/basic/main.js');
    const toggle = page.getByLabelText('Fixed drawing angles'); await expect.element(toggle).toBeEnabled();
    const instance = spy.mock.contexts.find(context => context instanceof Map);
    if (!(instance instanceof Map)) throw new Error('Expected demo map'); map = instance;
    const step = page.getByLabelText('Angle step'); await expect.element(step).toBeDisabled();
    await toggle.click(); await step.selectOptions('90');
    await page.getByRole('button', { name: 'Draw a line', exact: true }).click();
    const canvas = document.querySelector('canvas')!;
    await userEvent.click(canvas, { position: { x: 150, y: 200 } });
    await userEvent.click(canvas, { position: { x: 350, y: 260 } });
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    const output = (): GeometryFeatureCollection => JSON.parse(document.querySelector<HTMLTextAreaElement>('#output')!.value) as GeometryFeatureCollection;
    const after = output(); const line = after.features[0] as LineFeature;
    expect(line.geometry.coordinates[0]![1]).toBe(line.geometry.coordinates[1]![1]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output().features).toHaveLength(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(after);
    await step.selectOptions('45'); await page.getByRole('button', { name: 'Draw a line', exact: true }).click();
    await userEvent.click(canvas, { position: { x: 100, y: 350 } });
    await userEvent.click(canvas, { position: { x: 230, y: 450 } });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(output()).toEqual(after);
    await toggle.click(); await expect.element(step).toBeDisabled();
  } finally { map?.remove(); spy.mockRestore(); }
});
