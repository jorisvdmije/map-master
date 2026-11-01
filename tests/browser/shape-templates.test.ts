import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { EditorToolbar, GeometryEditor, type Coordinate, type DataChangeEvent, type GeometryFeatureCollection } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const at = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const button = (tool: string) => container.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)!;
const input = (key: string) => container.querySelector<HTMLInputElement>(`input[data-template="${key}"]`)!;
const choice = () => container.querySelector<HTMLSelectElement>('select[data-template]')!;
const finish = () => [...container.querySelectorAll<HTMLButtonElement>('.mm-toolbar-action')].find(element => element.textContent === 'Finish')!;
const border = () => container.querySelector('[data-geo-draft-border] [data-geo-border]');
const group = (): GeometryFeatureCollection => ({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'shape', properties: { name: 'Custom', nested: { tags: ['a'] } },
  geometry: { type: 'Polygon', coordinates: [[at(300, 200), at(400, 200), at(400, 260), at(300, 260), at(300, 200)]] } },
{ type: 'Feature', id: 'point', properties: { mapMasterText: { text: 'Label' } }, geometry: { type: 'Point', coordinates: at(350, 210) } }] });

beforeEach(async () => {
  errors.length = 0;
  container = document.createElement('div'); container.style.cssText = 'width:800px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 16, fadeDuration: 0 });
  map.on('error', event => { errors.push(event.error.message); });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { editor.destroy(); map.remove(); container.remove(); expect(errors).toEqual([]); });

it('previews the cursor, anchors a star, changes size/rotation and commits one transaction with exact Undo/Redo', async () => {
  map.addControl(new EditorToolbar(editor, { tools: ['template', 'line', 'undo', 'redo'] }));
  const transaction = vi.fn(); const change = vi.fn<(event: DataChangeEvent) => void>(); editor.onTransaction(transaction); editor.onDataChange(change);
  await userEvent.click(button('template')); expect(editor.getState().mode).toBe('draw-template'); expect(finish().disabled).toBe(true);
  await commands.vertexPointer('move', 500, 320);
  await expect.poll(() => border()?.getAttribute('d')).toContain('M');
  expect(editor.getTemplateDraft()?.position).toBeNull(); expect(editor.exportGeoJSON().features).toEqual([]);
  await click(500, 320); await userEvent.selectOptions(page.getByRole('combobox', { name: 'Template', exact: true }), 'star');
  expect(button('line').disabled).toBe(true);
  await userEvent.fill(input('size'), '320'); await userEvent.fill(input('rotation'), '45');
  const preview = editor.getTemplatePreview()!; expect(preview.features[0]?.properties?.shape).toBe('star');
  const anchor = editor.getTemplateDraft()!.position!; expect(map.project(anchor).x).toBeCloseTo(500, 5);
  await commands.vertexPointer('move', 650, 400); expect(editor.getTemplateDraft()?.position).toEqual(anchor);
  await userEvent.click(finish()); expect(transaction).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
  expect(change.mock.calls[0]?.[0].source).toBe('transaction');
  const saved = editor.exportGeoJSON(); expect(saved.features[0]?.id).not.toBe('star'); expect(saved.features[0]?.geometry).toEqual(preview.features[0]?.geometry);
  expect(editor.getState().mode).toBe('idle'); editor.undo(); expect(editor.getState().featureCount).toBe(0);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(saved);
});

it('supports complete keyboard placement, keeps partial coordinate input and does not commit invalid fields or composition', async () => {
  editor.setKeyboardShortcuts({ template: [{ key: 't' }] });
  map.addControl(new EditorToolbar(editor, { tools: ['template', 'undo'] }));
  map.getCanvas().focus(); await userEvent.keyboard('t'); expect(editor.getState().mode).toBe('draw-template');
  await userEvent.fill(input('longitude'), '4.895'); expect(finish().disabled).toBe(true);
  await userEvent.fill(input('latitude'), '52.372'); expect(finish().disabled).toBe(false);
  expect(input('longitude').value).toBe('4.895');
  await userEvent.fill(input('size'), '0'); expect(finish().disabled).toBe(true); expect(input('size').getAttribute('aria-invalid')).toBe('true');
  await userEvent.fill(input('size'), '250'); expect(finish().disabled).toBe(false);
  input('size').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  expect(editor.getState().featureCount).toBe(0); await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('idle');
  const before = editor.exportGeoJSON(); await userEvent.click(button('template')); await userEvent.fill(input('rotation'), '35');
  await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON()).toEqual(before);
});

it('snaps the template anchor to existing vertices, bypasses with Alt and cancels without using IDs', async () => {
  let allocated = 0; editor.destroy(); editor = new GeometryEditor(map, { createId: () => ++allocated, snapping: { enabled: true } });
  editor.importGeoJSON({ type: 'Feature', id: 'reference', properties: null, geometry: { type: 'Point', coordinates: at(500, 300) } });
  editor.setLockedFeatureIds(['reference']); editor.clearHistory(); editor.drawTemplate();
  await click(505, 304); expect(editor.getTemplateDraft()?.position).toEqual(at(500, 300)); editor.cancel();
  expect(allocated).toBe(0); expect(editor.getState().canUndo).toBe(false);
  editor.drawTemplate(); await userEvent.keyboard('{Alt>}'); await click(505, 304); await userEvent.keyboard('{/Alt}');
  expect(map.project(editor.getTemplateDraft()!.position!).x).toBeCloseTo(505, 5);
  expect(map.project(editor.getTemplateDraft()!.position!).y).toBeCloseTo(304, 5); editor.finish(); expect(allocated).toBe(1);
  expect(editor.getFeature('reference')?.geometry.coordinates).toEqual(at(500, 300));
});

it('uses custom GeoJSON groups and an application picker, preserves properties and renders names as text', async () => {
  editor.setShapeTemplates([{ id: 'custom', label: '<img src=x onerror=alert(1)>', data: group() }]);
  let cancelled = true; const picker = vi.fn(() => cancelled ? null : 'custom');
  map.addControl(new EditorToolbar(editor, { tools: ['template', 'line', 'undo'], templatePicker: picker }));
  await userEvent.click(button('line')); await userEvent.click(button('template')); expect(editor.getState().mode).toBe('draw-line');
  cancelled = false; await userEvent.click(button('template')); expect(editor.getState().mode).toBe('draw-template');
  expect(picker).toHaveBeenCalledTimes(2); expect(choice().textContent).toContain('<img src=x'); expect(choice().querySelector('img')).toBeNull();
  await click(500, 330); await expect.poll(() => container.querySelector('.mm-text-marker')?.textContent).toBe('Label');
  await userEvent.click(finish()); expect(editor.getSelection()).toHaveLength(2);
  expect(editor.getSelection()[0]?.properties).toEqual(group().features[0]?.properties);
  expect(editor.getSelection().map(feature => feature.id)).not.toEqual(['shape', 'point']);
  editor.undo(); expect(editor.getState().featureCount).toBe(0); editor.redo(); expect(editor.getState().featureCount).toBe(2);
});

it('blocks invalid transformations, keeps committed data/history unchanged and recovers after correcting placement', async () => {
  map.addControl(new EditorToolbar(editor, { tools: ['template', 'undo'] }));
  await userEvent.click(button('template')); editor.setTemplatePlacement({ position: [180, 0] });
  expect(editor.getState().templateError).toBe('template-out-of-bounds'); expect(finish().disabled).toBe(true);
  expect(container.querySelector<HTMLElement>('.mm-toolbar-template-notice')!.hidden).toBe(false);
  expect(editor.finish()).toBeNull(); expect(editor.getState().featureCount).toBe(0);
  editor.setTemplatePlacement({ position: at(500, 300) }); expect(finish().disabled).toBe(false); await userEvent.click(finish());
  expect(editor.getState().featureCount).toBe(1);
});

it('retains the anchored preview across camera/style changes and tears down every preview resource', async () => {
  editor.drawTemplate('star', { position: at(500, 300), size: 300, rotation: 30 }); const preview = editor.getTemplatePreview();
  await expect.poll(() => border()?.getAttribute('d')).toContain('M'); const path = border()!.getAttribute('d');
  map.jumpTo({ center: at(430, 250), bearing: 25, pitch: 20 }); await expect.poll(() => border()?.getAttribute('d')).not.toBe(path);
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(() => border()?.getAttribute('d')).toContain('M'); expect(editor.getTemplatePreview()).toEqual(preview);
  editor.destroy(); expect(container.querySelector('[data-geo-draft-border]')).toBeNull();
  editor = new GeometryEditor(map); editor.drawTemplate('arrow', { position: at(500, 300) }); await expect.poll(() => border()).not.toBeNull();
  map.remove(); expect(container.querySelector('[data-geo-draft-border]')).toBeNull();
});

it('disables the template tool for an empty library and refreshes the picker after an atomic replacement', async () => {
  editor.setShapeTemplates([]); map.addControl(new EditorToolbar(editor, { tools: ['template'] })); expect(button('template').disabled).toBe(true);
  editor.setShapeTemplates([{ id: 'group', label: 'Custom group', data: group() }]); expect(button('template').disabled).toBe(false);
  await userEvent.click(button('template')); expect([...choice().options].map(option => option.value)).toEqual(['group']);
  container.style.width = '320px'; map.resize();
  const panel = container.querySelector<HTMLElement>('.mm-toolbar-actions')!.getBoundingClientRect();
  expect(panel.right).toBeLessThanOrEqual(container.getBoundingClientRect().right);
  for (const field of container.querySelectorAll('.mm-toolbar-template label')) expect(field.getBoundingClientRect().height).toBeLessThan(40);
  expect(() => editor.setShapeTemplates([])).toThrow(); editor.cancel();
});
