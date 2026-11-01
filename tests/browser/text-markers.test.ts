import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { EditorToolbar, GeometryEditor, type Coordinate, type TextMarkerFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const at = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const label = (id: string | number = 'label', text = 'Meeting point'): TextMarkerFeature => ({ type: 'Feature', id,
  geometry: { type: 'Point', coordinates: at(300, 220) }, properties: { mapMasterText: { text, style: { fontSize: 20, color: '#123456', fontWeight: 'bold' } }, name: 'Label' } });
const labels = () => [...container.querySelectorAll<HTMLElement>('.mm-text-marker')];
const text = () => container.querySelector<HTMLTextAreaElement>('[data-text-marker="text"]')!;
const size = () => container.querySelector<HTMLInputElement>('[data-text-marker="fontSize"]')!;
const button = (tool: string) => container.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)!;
const action = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('.mm-toolbar-action')].find(element => element.textContent === name)!;

beforeEach(async () => {
  errors.length = 0;
  container = document.createElement('div'); container.style.cssText = 'width:800px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  map.on('error', event => { errors.push(event.error.message); });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 750, 460);
  editor.destroy(); map.remove(); container.remove(); expect(errors).toEqual([]);
});

it('creates and styles multiline text with the toolbar, with one creation and exact history', async () => {
  const create = vi.fn(); editor.onCreate(create);
  map.addControl(new EditorToolbar(editor, { tools: ['text', 'edit', 'undo', 'redo'] }));
  await userEvent.click(button('text')); expect(editor.getState().mode).toBe('draw-text');
  expect(action('Finish').disabled).toBe(true);
  await click(500, 320); expect(editor.exportGeoJSON().features).toEqual([]);
  await userEvent.fill(text(), 'Café 🌷\nEntrance <b>A</b>'); await userEvent.fill(size(), '24');
  expect(action('Finish').disabled).toBe(false);
  await expect.poll(() => labels()[0]?.textContent).toBe('Café 🌷\nEntrance <b>A</b>');
  expect(labels()[0]!.querySelector('b')).toBeNull(); expect(labels()[0]!.style.fontSize).toBe('24px');
  text().focus(); await userEvent.keyboard('{Control>}{Enter}{/Control}');
  expect(editor.getState().mode).toBe('idle'); expect(create).toHaveBeenCalledOnce();
  const saved = editor.exportGeoJSON(); expect(saved.features[0]?.properties?.mapMasterText).toMatchObject({ text: 'Café 🌷\nEntrance <b>A</b>', style: { fontSize: 24 } });
  editor.undo(); expect(labels()).toHaveLength(0); editor.redo(); expect(editor.exportGeoJSON()).toEqual(saved); expect(labels()).toHaveLength(1);
});

it('keeps text entry, composition, blank text and invalid styles out of commits; Escape cancels', async () => {
  map.addControl(new EditorToolbar(editor, { tools: ['text', 'line', 'edit', 'delete', 'undo'] }));
  await userEvent.click(button('text')); expect(button('line').disabled).toBe(false);
  await userEvent.fill(text(), 'Draft before placement'); expect(button('line').disabled).toBe(true);
  await click(400, 250);
  await userEvent.fill(text(), 'Keep typing'); await userEvent.keyboard('{Enter}next');
  expect(editor.getTextMarkerDraft()?.text).toBe('Keep typing\nnext'); expect(editor.getState().mode).toBe('draw-text');
  await userEvent.fill(size(), '100'); expect(size().getAttribute('aria-invalid')).toBe('true'); expect(action('Finish').disabled).toBe(true);
  await userEvent.fill(size(), '22'); expect(action('Finish').disabled).toBe(false);
  await userEvent.fill(text(), ' \n '); expect(action('Finish').disabled).toBe(true);
  text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  expect(editor.getState().mode).toBe('draw-text');
  await userEvent.keyboard('{Escape}'); expect(editor.getState().mode).toBe('idle');
  expect(editor.getState().canUndo).toBe(false); expect(labels()).toHaveLength(0);
});

it('renders imported HTML as literal text, picks the full label and moves it with a synchronous label preview', async () => {
  editor.importGeoJSON(label('label', '<img src=x onerror=alert(1)> Meeting point')); editor.clearHistory();
  expect(labels()).toHaveLength(1); expect(labels()[0]!.children).toHaveLength(0); expect(labels()[0]!.style.color).toBe('rgb(18, 52, 86)');
  await click(380, 220); expect(editor.getSelected()?.id).toBe('label'); // Far outside the Point circle.
  const before = editor.exportGeoJSON();
  await commands.vertexPointer('down', 380, 220); await commands.vertexPointer('move', 440, 260);
  await expect.poll(() => labels().find(element => element.dataset.preview === 'true')?.style.transform).toContain('360');
  expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Escape}'); await commands.vertexPointer('up', 440, 260); expect(editor.exportGeoJSON()).toEqual(before);
  await commands.vertexPointer('down', 380, 220); await commands.vertexPointer('move', 440, 260); await commands.vertexPointer('up', 440, 260);
  expect(map.project(editor.getSelected()!.geometry.coordinates as Coordinate).x).toBeCloseTo(360, 5);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});

it('edits text, appearance and position together, and locks cancel pending changes', async () => {
  editor.importGeoJSON(label()); editor.select('label'); editor.clearHistory(); const before = editor.exportGeoJSON();
  map.addControl(new EditorToolbar(editor, { tools: ['text', 'edit', 'duplicate', 'delete', 'undo'] }));
  const update = vi.fn(); editor.onUpdate(update);
  await userEvent.click(button('edit')); await userEvent.fill(text(), 'New label'); editor.moveVertex(0, at(450, 300));
  expect(editor.exportGeoJSON()).toEqual(before); await userEvent.click(action('Save'));
  expect(update).toHaveBeenCalledOnce(); const saved = editor.exportGeoJSON(); editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
  editor.redo(); expect(editor.exportGeoJSON()).toEqual(saved);
  await userEvent.click(button('edit')); await userEvent.fill(text(), 'Discard'); editor.setLockedFeatureIds(['label']);
  expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON()).toEqual(saved); expect(button('edit').disabled).toBe(true);
  expect(labels()[0]?.textContent).toBe('New label');
});

it('supports label tool shortcuts, typed overlapping IDs, box selection, duplication and deletion', async () => {
  editor.setKeyboardShortcuts({ text: [{ key: 't' }] }); map.getCanvas().focus(); await userEvent.keyboard('t');
  expect(editor.getState().mode).toBe('draw-text'); editor.cancel();
  editor.importGeoJSON({ type: 'FeatureCollection', features: [label(0), label('0')] });
  expect(new Set(editor.queryFeatures({ x: 350, y: 220 }).map(feature => feature.id))).toEqual(new Set([0, '0']));
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down', 365, 195); await commands.vertexPointer('move', 395, 240); await commands.vertexPointer('up', 395, 240); await userEvent.keyboard('{/Shift}');
  expect(new Set(editor.getState().selectedFeatureIds)).toEqual(new Set([0, '0']));
  editor.duplicateSelection([0.001, 0]); expect(labels()).toHaveLength(4); editor.deleteSelection(); expect(labels()).toHaveLength(2);
  editor.undo(); expect(labels()).toHaveLength(4);
});

it('follows the camera, retains drafts across style reload and cleans up on both editor and map teardown', async () => {
  editor.importGeoJSON(label()); editor.select('label'); editor.editSelected(); editor.setTextMarker({ text: 'Draft' });
  await expect.poll(() => labels()[0]?.textContent).toBe('Draft');
  const previous = labels()[0]!.style.transform; map.jumpTo({ center: at(330, 220), bearing: 25, pitch: 20 });
  expect(labels()[0]!.style.transform).not.toBe(previous);
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(() => labels()[0]?.textContent).toBe('Draft'); expect(editor.getTextMarkerDraft()?.text).toBe('Draft');
  editor.cancel(); expect(labels()[0]?.textContent).toBe('Meeting point');
  editor.destroy(); expect(container.querySelector('.mm-text-markers')).toBeNull();
  editor = new GeometryEditor(map); editor.importGeoJSON(label()); map.remove(); expect(container.querySelector('.mm-text-markers')).toBeNull();
});
