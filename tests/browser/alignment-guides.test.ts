import { Map, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { EditorToolbar, GeometryEditor, type Coordinate, type GeometryFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const at = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const marker = (id: string | number, x: number, y: number): GeometryFeature => ({ type: 'Feature', id, properties: { name: String(id) }, geometry: { type: 'Point', coordinates: at(x, y) } });
const overlay = () => container.querySelector('[data-geo-alignment-guides]');
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const pixel = (coordinate: Coordinate | undefined) => coordinate ? map.project(coordinate) : { x: NaN, y: NaN };
const references = () => {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [marker(0, 300, 100), marker('0', 600, 200)] });
  editor.clearHistory();
};

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:800px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 16, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { alignmentGuides: { enabled: true } });
});
afterEach(async () => {
  await userEvent.keyboard('{/Alt}{/Shift}');
  await commands.vertexPointer('up', 750, 450);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it.each([0, 35])('aligns drawing in screen pixels at bearing %s, exposes independent results and commits exact Undo/Redo', async bearing => {
  map.jumpTo({ bearing, pitch: bearing }); references();
  const before = editor.exportGeoJSON(); const data = vi.fn(); editor.onDataChange(data);
  editor.draw('LineString'); await commands.vertexPointer('move', 304, 205);
  await expect.poll(() => editor.getAlignment()?.guides).toHaveLength(2);
  expect(pixel(editor.getAlignment()?.coordinate).x).toBeCloseTo(300, 5);
  expect(pixel(editor.getAlignment()?.coordinate).y).toBeCloseTo(200, 5);
  expect(editor.getSnap()).toBeNull(); expect(overlay()?.querySelectorAll('line')).toHaveLength(2);
  const result = editor.getAlignment()!; result.guides[0]!.start.x = 0; result.coordinate[0] = 0;
  expect(editor.getAlignment()).not.toEqual(result); expect(data).not.toHaveBeenCalled();
  await click(304, 205); await click(450, 330); editor.finish();
  const saved = editor.exportGeoJSON(); expect(data).toHaveBeenCalledOnce(); expect(overlay()).toBeNull();
  const line = saved.features.at(-1)!.geometry; if (line.type !== 'LineString') throw new Error('Expected a line');
  expect(pixel(line.coordinates[0]).x).toBeCloseTo(300, 5); expect(pixel(line.coordinates[0]).y).toBeCloseTo(200, 5);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); editor.redo(); expect(editor.exportGeoJSON()).toEqual(saved);
});

it('uses recent draft points and extended edges, and gives exact snapping and drawing constraints priority', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'edge', properties: {}, geometry: { type: 'LineString', coordinates: [at(100, 100), at(200, 200)] } });
  editor.setAlignmentGuides({ horizontal: false, vertical: false }); editor.draw('LineString');
  await commands.vertexPointer('move', 304, 300);
  await expect.poll(() => editor.getAlignment()?.guides[0]?.kind).toBe('extension');
  expect(pixel(editor.getAlignment()?.coordinate).x).toBeCloseTo(302, 5);
  editor.cancel(); editor.setAlignmentGuides({ horizontal: true, vertical: true });
  editor.setSnapping({ enabled: true }); editor.draw('LineString'); await commands.vertexPointer('move', 204, 203);
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex'); expect(editor.getAlignment()).toBeNull();
  editor.cancel(); editor.setSnapping({ enabled: false }); editor.draw('LineString'); await click(450, 330);
  await commands.vertexPointer('move', 550, 334);
  await expect.poll(() => editor.getAlignment()?.guides[0]?.featureId).toBeNull();
  expect(pixel(editor.getAlignment()?.coordinate).y).toBeCloseTo(330, 5);
  editor.setDrawingConstraints({ enabled: true });
  await expect.poll(() => editor.getAlignment()).toBeNull(); expect(overlay()).toBeNull(); editor.cancel();
});

it('refreshes a stationary pointer on Alt, settings and appearance; validates patches without changing state', async () => {
  references(); editor.draw('LineString'); await commands.vertexPointer('move', 304, 205);
  await expect.poll(() => editor.getAlignment()).not.toBeNull();
  await userEvent.keyboard('{Alt>}'); await expect.poll(() => editor.getAlignment()).toBeNull();
  await userEvent.keyboard('{/Alt}'); await expect.poll(() => editor.getAlignment()).not.toBeNull();
  editor.setAlignmentGuides({ distance: 2 }); await expect.poll(() => editor.getAlignment()).toBeNull();
  editor.setAlignmentGuides({ distance: 8 }); await expect.poll(() => editor.getAlignment()).not.toBeNull();
  editor.setAppearance({ snap: { color: '#ff00aa', opacity: 0.4 } });
  expect(overlay()?.querySelector('line')?.getAttribute('stroke')).toBe('#ff00aa');
  expect((overlay() as SVGElement).style.opacity).toBe('0.4');
  const previous = editor.getAlignmentGuides(); expect(() => editor.setAlignmentGuides({ distance: NaN })).toThrow();
  expect(editor.getAlignmentGuides()).toEqual(previous); editor.getAlignmentGuides().enabled = false;
  expect(editor.getAlignmentGuides().enabled).toBe(true);
  editor.setAlignmentGuides({ enabled: false }); expect(overlay()).toBeNull(); editor.cancel();
});

it('aligns edited vertices to frozen stationary draft references, excludes moving sources and rolls back Escape', async () => {
  editor.importGeoJSON({ type: 'Feature', id: 'line', properties: { nested: { tags: ['keep'] } }, geometry: { type: 'LineString', coordinates: [at(200, 150), at(450, 300), at(650, 350)] } });
  editor.clearHistory(); editor.select('line'); editor.editSelected(); const draft = editor.getDraft(); const before = editor.exportGeoJSON();
  await commands.vertexPointer('down', 200, 150); await commands.vertexPointer('move', 204, 155);
  await expect.poll(() => pixel(editor.getDraft()[0]).x).toBeCloseTo(204, 5); expect(editor.getAlignment()).toBeNull();
  await commands.vertexPointer('move', 455, 220);
  await expect.poll(() => editor.getAlignment()?.guides[0]?.kind).toBe('vertical');
  expect(pixel(editor.getDraft()[0]).x).toBeCloseTo(450, 5); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Escape}'); expect(editor.getDraft()).toEqual(draft); expect(overlay()).toBeNull();
  await commands.vertexPointer('up', 455, 220);
  editor.setAlignmentGuides({ enabled: false });
  await commands.vertexPointer('down', 200, 150); await commands.vertexPointer('move', 455, 220);
  await expect.poll(() => pixel(editor.getDraft()[0]).x).toBeCloseTo(455, 5);
  editor.setAlignmentGuides({ enabled: true });
  await expect.poll(() => pixel(editor.getDraft()[0]).x).toBeCloseTo(450, 5);
  await userEvent.keyboard('{Alt>}'); await expect.poll(() => pixel(editor.getDraft()[0]).x).toBeCloseTo(455, 5);
  await userEvent.keyboard('{/Alt}'); await commands.vertexPointer('up', 455, 220);
  expect(editor.getAlignment()).toBeNull(); const saved = editor.finish(); expect(saved?.properties).toEqual(before.features[0]?.properties);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});

it('aligns a selected group using its grabbed anchor and commits once, with Alt and Shift taking effect live', async () => {
  references(); editor.importGeoJSON({ type: 'FeatureCollection', features: [marker('moving', 100, 350), marker('other', 170, 400)] });
  editor.selectMany(['moving', 'other']); editor.clearHistory(); const before = editor.exportGeoJSON();
  const layer = Object.keys(map.getStyle().sources).find(id => id.endsWith('-features'))!;
  await expect.poll(() => map.queryRenderedFeatures({ layers: [layer] }).length).toBeGreaterThanOrEqual(4);
  const transaction = vi.fn(); editor.onTransaction(transaction);
  await commands.vertexPointer('down', 100, 350); await commands.vertexPointer('move', 304, 205);
  await expect.poll(() => editor.getAlignment()?.guides).toHaveLength(2); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Alt>}'); await expect.poll(() => editor.getAlignment()).toBeNull();
  await userEvent.keyboard('{/Alt}'); await expect.poll(() => editor.getAlignment()).not.toBeNull();
  await userEvent.keyboard('{Shift>}'); await expect.poll(() => editor.getAlignment()).toBeNull();
  await userEvent.keyboard('{/Shift}'); await expect.poll(() => editor.getAlignment()).not.toBeNull();
  await commands.vertexPointer('up', 304, 205); expect(transaction).toHaveBeenCalledOnce(); expect(overlay()).toBeNull();
  const moved = editor.getFeature('moving')!.geometry; if (moved.type !== 'Point') throw new Error('Expected point');
  expect(pixel(moved.coordinates).x).toBeCloseTo(300, 5); expect(pixel(moved.coordinates).y).toBeCloseTo(200, 5);
  expect(editor.getFeature(0)).toEqual(before.features[0]); const saved = editor.exportGeoJSON();
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before); editor.redo(); expect(editor.exportGeoJSON()).toEqual(saved);
});

it.each(['touch', 'pen'] as const)('aligns a %s vertex gesture against locked references without moving them', async pointer => {
  references(); editor.setLockedFeatureIds([0, '0']);
  editor.importGeoJSON(marker('moving', 100, 350)); editor.select('moving'); editor.editSelected();
  const before = editor.exportGeoJSON();
  if (pointer === 'touch') {
    await commands.touchContact('start', [{ id: 1, x: 100, y: 350 }]);
    await commands.touchContact('move', [{ id: 1, x: 304, y: 205 }]);
  } else {
    await commands.penContact('down', 100, 350); await commands.penContact('move', 304, 205);
  }
  await expect.poll(() => editor.getAlignment()?.guides).toHaveLength(2);
  expect(pixel(editor.getDraft()[0]).x).toBeCloseTo(300, 5); expect(pixel(editor.getDraft()[0]).y).toBeCloseTo(200, 5);
  if (pointer === 'touch') await commands.touchContact('end', []); else await commands.penContact('up', 304, 205);
  expect(overlay()).toBeNull(); editor.finish(); expect(editor.getFeature(0)).toEqual(before.features[0]);
  expect(editor.getFeature('0')).toEqual(before.features[1]);
});

it('aligns a vertex group by one anchor without acquiring its old vertices or incident edges', async () => {
  references(); editor.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [at(100, 350), at(170, 400), at(700, 450)] } });
  editor.select('line'); editor.editSelected(); editor.selectVertices([0, 1]);
  const before = editor.getDraft();
  await commands.vertexPointer('down', 100, 350); await commands.vertexPointer('move', 304, 205);
  await expect.poll(() => editor.getAlignment()?.guides).toHaveLength(2);
  const draft = editor.getDraft(); const delta: Coordinate = [draft[0]![0] - before[0]![0], draft[0]![1] - before[0]![1]];
  expect(draft[1]![0]).toBeCloseTo(before[1]![0] + delta[0], 12); expect(draft[1]![1]).toBeCloseTo(before[1]![1] + delta[1], 12);
  expect(draft[2]).toEqual(before[2]);
  await commands.vertexPointer('up', 304, 205); expect(overlay()).toBeNull();
});

it.each(['blur', 'style', 'cancel', 'destroy', 'remove'] as const)('cleans the active overlay on %s and rebuilds after camera or data changes', async reason => {
  references(); editor.draw('LineString'); await commands.vertexPointer('move', 304, 205);
  await expect.poll(() => overlay()).not.toBeNull();
  map.jumpTo({ bearing: 20, pitch: 15 });
  const reference = editor.getFeature(0)!.geometry; if (reference.type !== 'Point') throw new Error('Expected point');
  const target = pixel(reference.coordinates);
  await commands.vertexPointer('move', target.x + 4, 260);
  await expect.poll(() => editor.getAlignment()).not.toBeNull();
  if (reason === 'blur') window.dispatchEvent(new Event('blur'));
  if (reason === 'cancel') editor.cancel();
  if (reason === 'destroy') editor.destroy();
  if (reason === 'remove') map.remove();
  if (reason === 'style') {
    const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
    map.setStyle(style(), { diff: false }); await loaded;
    await commands.vertexPointer('move', target.x + 4, 260); await expect.poll(() => overlay()).not.toBeNull(); editor.cancel();
    editor.applyTransaction({ delete: [0, '0'] }); editor.draw('LineString'); await commands.vertexPointer('move', 304, 205);
    await expect.poll(() => overlay()).toBeNull();
  }
  await expect.poll(() => overlay()).toBeNull(); expect(editor.getAlignment()).toBeNull();
});

it('toggles the toolbar and remapped canvas shortcut without touching data, selection or history', async () => {
  references(); editor.select(0); const before = editor.exportGeoJSON();
  editor.setKeyboardShortcuts({ guides: [{ key: 'g' }] });
  map.addControl(new EditorToolbar(editor, { tools: ['guides', 'line', 'undo'] }));
  const button = container.querySelector<HTMLButtonElement>('[data-tool="guides"]')!;
  expect(button.getAttribute('aria-pressed')).toBe('true'); expect(button.title).toContain('G');
  await userEvent.click(button); expect(editor.getAlignmentGuides().enabled).toBe(false);
  map.getCanvas().focus(); await userEvent.keyboard('g'); expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().selectedFeatureId).toBe(0); expect(editor.getState().canUndo).toBe(false);
});
