import { Map } from 'maplibre-gl';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import html from '../../examples/basic/index.html?raw';
import type { GeometryFeatureCollection } from '../../src/index.js';

it('keeps commands reachable, explains eligibility and loads repeatable examples without replacing work', async () => {
  const spy = vi.spyOn(Map.prototype, 'fitBounds'); let map: Map | undefined;
  try {
    history.replaceState(null, '', `${location.pathname}?basemap=off`);
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    document.querySelectorAll('script').forEach(script => { script.remove(); });
    await import('../../examples/basic/main.js');
    const add = page.getByRole('button', { name: 'Add example', exact: true });
    await expect.element(add).toBeEnabled();
    const output = (): GeometryFeatureCollection => JSON.parse(document.querySelector<HTMLTextAreaElement>('#output')!.value) as GeometryFeatureCollection;
    const canvas = document.querySelector('canvas')!;
    const rect = () => { const r = canvas.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
    const initialRect = rect();
    await add.click();
    const instance = spy.mock.contexts[0];
    if (!(instance instanceof Map)) throw new Error('Expected example map'); map = instance;
    const original = output(); expect(original.features).toHaveLength(2);
    expect(rect()).toEqual(initialRect); // Selection/status changes must not resize the map.
    const edit = document.querySelector<HTMLButtonElement>('#edit-selected')!;
    expect(edit.disabled).toBe(true);
    expect(document.getElementById(edit.getAttribute('aria-describedby')!)!.textContent).toBe('Select exactly one shape to edit its vertices.');
    await page.getByRole('button', { name: 'Lock selection', exact: true }).click();
    expect(edit.title).toContain('Unlock');
    await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
    expect(edit.title).toContain('exactly one');

    const reachable = (id: string) => {
      const element = document.getElementById(id)!; const r = element.getBoundingClientRect();
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(innerWidth); expect(r.bottom).toBeLessThanOrEqual(innerHeight);
      expect(element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))).toBe(true);
    };
    // The original bug: opening a deep tool scrolled Apply, Cancel and feedback away.
    for (const [width, height] of [[1280, 900], [1000, 800], [760, 800], [390, 844], [320, 568]]) {
      await page.viewport(width!, height!);
      // MapLibre resizes on the next frame and rounds fractional CSS dimensions.
      await expect.poll(() => Math.abs(canvas.getBoundingClientRect().bottom - document.getElementById('map')!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
      const dock = document.querySelector('.selection-toolbar')!.getBoundingClientRect();
      expect(dock.top).toBeGreaterThanOrEqual(canvas.getBoundingClientRect().bottom);
      expect(dock.bottom).toBeLessThanOrEqual(document.querySelector('.map-panel')!.getBoundingClientRect().bottom);
      await page.getByRole('button', { name: 'Buffer selection', exact: true }).click();
      expect(document.getElementById('operation-title')!.textContent).toBe('Buffer selection');
      await expect.element(add).toBeDisabled();
      expect(document.querySelector<HTMLElement>('#operation-settings')!.hidden).toBe(false);
      const before = rect();
      const sidebar = document.querySelector('.sidebar')!;
      sidebar.scrollTop = sidebar.scrollHeight;
      for (const id of ['finish', 'cancel', 'undo', 'redo', 'status']) reachable(id);
      expect(document.documentElement.scrollWidth).toBe(innerWidth);
      expect(document.documentElement.scrollHeight).toBe(innerHeight);
      await page.getByLabelText('Buffer distance (Mercator meters)').fill('25');
      expect(rect()).toEqual(before);
      expect(output()).toEqual(original);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(output()).toEqual(original); expect(rect()).toEqual(before);
    }
    await page.viewport(1000, 800);
    await page.getByRole('button', { name: 'Buffer selection', exact: true }).click();
    await page.getByRole('button', { name: 'Apply buffer', exact: true }).click();
    const saved = output(); expect(saved).not.toEqual(original);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(output()).toEqual(saved);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();

    await add.click(); const twice = output(); expect(twice.features).toHaveLength(4);
    expect(twice.features.slice(0, 2)).toEqual(original.features);
    expect(new Set(twice.features.map(f => f.id)).size).toBe(4);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    // Every displayed example must load via the public importer and remain one Undo.
    const select = document.getElementById('example') as HTMLSelectElement;
    for (const option of [...select.options].slice(1)) {
      await page.getByLabelText('Try an example').selectOptions(option.value);
      await add.click(); expect(output().features.length).toBeGreaterThan(original.features.length);
      expect(output().features.slice(0, original.features.length)).toEqual(original.features);
      expect(document.getElementById('example-status')!.textContent).toMatch(/^Added /u);
      if (option.value === 'shared-boundary' || option.value === 'intersection') {
        await page.viewport(320, 568);
        await page.getByRole('button', { name: option.value === 'shared-boundary' ? 'Edit shared boundary' : 'Intersect polygons', exact: true }).click();
        // Long labels such as “Save both polygons” also fit the narrow action bar.
        for (const id of ['finish', 'cancel', 'undo', 'redo']) reachable(id);
        expect(document.documentElement.scrollWidth).toBe(innerWidth);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.viewport(1000, 800);
      }
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(output()).toEqual(original);
    }
    const guide = document.querySelector<HTMLAnchorElement>('.guide-link')!;
    expect(guide.getAttribute('href')).toBe('./guide.html'); expect(guide.target).toBe('_blank');
  } finally { map?.remove(); spy.mockRestore(); await page.viewport(1000, 800); }
}, 45_000);
