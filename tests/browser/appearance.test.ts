import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { GeometryEditor, LineEditor, type Coordinate, type EditorAppearanceOptions } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const layerId = (suffix: string) => map.getStyle().layers.find((layer) => layer.id.endsWith(suffix))!.id;
const source = (suffix: string) => map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find((id) => id.endsWith(suffix))!)!;
const coordinate = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const border = (kind = 'draft-border') => container.querySelector<SVGPathElement>(`[data-geo-${kind}] [data-geo-border]`);
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
async function fixture(): Promise<void> {
  editor.importGeoJSON({ type: 'Feature', id: 'area', properties: { lineColor: '#bad', name: 'Area' }, geometry: { type: 'Polygon', coordinates: [
    [[100, 100], [400, 100], [400, 350], [100, 350], [100, 100]].map(([x, y]) => coordinate(x!, y!)),
  ] } });
  editor.clearHistory(); editor.select('area');
  await expect.poll(() => map.queryRenderedFeatures([250, 200], { layers: [layerId('-fill')] }).length).toBeGreaterThan(0);
}
beforeEach(async () => {
  errors.length = 0;
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  map.on('error', (event) => { errors.push(event.error.message); });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(async () => {
  if (map.getCanvas().isConnected) await commands.vertexPointer('up', 650, 450);
  vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
  expect(errors).toEqual([]);
});

it('applies constructor options and live patches without uploads, selection changes or history', async () => {
  editor.destroy();
  const options = { feature: { lineColor: '#123456', fillColor: '#abcdef' }, selected: { lineWidth: 9 } };
  editor = new GeometryEditor(map, { appearance: options });
  await fixture();
  const before = editor.exportGeoJSON(); const state = editor.getState();
  const uploads = vi.spyOn(source('-features'), 'setData'); const draftUploads = vi.spyOn(source('-draft'), 'setData');
  const changes = vi.fn(); const transaction = vi.fn(); editor.onChange(changes); editor.onTransaction(transaction);
  const patch = { selected: { lineColor: '#ACB', fillColor: '#fedcba', fillOpacity: 0.6 }, feature: { lineOpacity: 0.7 } };
  editor.setAppearance(patch);
  expect(map.getPaintProperty(layerId('-features'), 'line-color')).toEqual(['case', ['boolean', ['feature-state', 'selected'], false], '#acb', '#123456']);
  expect(map.getPaintProperty(layerId('-fill'), 'fill-color')).toEqual(['case', ['boolean', ['feature-state', 'selected'], false], '#fedcba', '#abcdef']);
  expect(map.getPaintProperty(layerId('-features'), 'line-width')).toEqual(['case', ['boolean', ['feature-state', 'selected'], false], 9, 4]);
  expect(uploads).not.toHaveBeenCalled(); expect(draftUploads).not.toHaveBeenCalled();
  expect(editor.getState()).toEqual(state); expect(editor.exportGeoJSON()).toEqual(before);
  expect(changes).toHaveBeenCalledOnce(); expect(transaction).not.toHaveBeenCalled();
  options.feature.lineColor = '#000'; patch.selected.lineColor = '#000';
  editor.getAppearance().feature.lineColor = '#000';
  expect(editor.getAppearance().feature.lineColor).toBe('#123456');
  expect(editor.getAppearance().selected.lineColor).toBe('#acb');
  const paint = vi.spyOn(map, 'setPaintProperty');
  editor.setAppearance({}); editor.setAppearance({ selected: { lineColor: '#ACB' } });
  expect(changes).toHaveBeenCalledOnce(); expect(paint).not.toHaveBeenCalled();
});

it('rejects a full invalid patch before any paint or notification and leaves no resources after invalid construction', () => {
  const previous = editor.getAppearance(); const paint = vi.spyOn(map, 'setPaintProperty'); const changed = vi.fn(); editor.onChange(changed);
  expect(() => editor.setAppearance({ feature: { lineColor: '#f00' }, vertex: { radius: -2 } })).toThrow();
  expect(editor.getAppearance()).toEqual(previous); expect(paint).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  editor.destroy();
  expect(() => new GeometryEditor(map, { appearance: { draft: { lineColor: 'red' } } })).toThrow('hex');
  expect(Object.keys(map.getStyle().sources)).toEqual([]);
  expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['background']);
  editor = new GeometryEditor(map); // A rejected constructor must not reserve ownership.
});

it('restyles active editing handles and SVG dots while preserving the exact draft and cancellation', async () => {
  await fixture(); const original = editor.exportGeoJSON(); editor.editSelected(); editor.selectVertex(1);
  editor.moveVertex(1, coordinate(430, 90));
  await expect.poll(() => border()).not.toBeNull();
  const before = editor.getDraft(); const path = border()!.getAttribute('d');
  const uploads = vi.spyOn(source('-draft'), 'setData');
  editor.setAppearance({ draft: { lineColor: '#987654', lineWidth: 5, lineOpacity: 0.4, fillColor: '#fedcba', fillOpacity: 0.6 },
    vertex: { radius: 8, activeRadius: 11, color: '#112233', activeColor: '#445566', lockedColor: '#778899', strokeWidth: 3, strokeColor: '#abcdef' },
    midpoint: { radius: 6, color: '#eee', strokeColor: '#123', strokeWidth: 2 } });
  expect(editor.getDraft()).toEqual(before); expect(editor.exportGeoJSON()).toEqual(original);
  expect(uploads).not.toHaveBeenCalled(); expect(border()!.getAttribute('d')).toBe(path);
  expect(border()!.getAttribute('stroke')).toBe('#987654'); expect(border()!.getAttribute('stroke-width')).toBe('5');
  expect(border()!.getAttribute('stroke-opacity')).toBe('0.4');
  expect(map.getPaintProperty(layerId('-vertices'), 'circle-radius')).toEqual(['case', ['boolean', ['get', 'active'], false], 11, 8]);
  expect(map.getPaintProperty(layerId('-vertices'), 'circle-color')).toEqual(['case', ['boolean', ['get', 'locked'], false], '#778899', ['boolean', ['get', 'active'], false], '#445566', '#112233']);
  expect(map.getPaintProperty(layerId('-midpoints'), 'circle-stroke-color')).toBe('#123');
  const projections = vi.spyOn(map, 'project');
  editor.setAppearance({ draft: { fillOpacity: 0.5 }, selected: { fillColor: '#123' } });
  expect(projections).not.toHaveBeenCalled();
  editor.cancel(); expect(border()).toBeNull(); expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canUndo).toBe(false);
});

it('retains the latest appearance when set during style replacement, including active draft and selection', async () => {
  await fixture(); editor.editSelected(); editor.moveVertex(1, coordinate(420, 90));
  await expect.poll(() => border()).not.toBeNull(); const draft = editor.getDraft(); const original = editor.exportGeoJSON();
  const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false });
  editor.setAppearance({ feature: { fillColor: '#0ab' }, draft: { lineColor: '#a0b', fillColor: '#abc', fillOpacity: 0.4 }, vertex: { radius: 9 } });
  await loaded;
  await expect.poll(() => border()?.getAttribute('stroke')).toBe('#a0b');
  expect(map.getPaintProperty(layerId('-draft-fill'), 'fill-opacity')).toBe(0.4);
  expect(map.getFeatureState({ source: layerId('-features'), id: '"area"' })).toMatchObject({ editing: true, selected: true });
  expect(editor.getDraft()).toEqual(draft); expect(editor.exportGeoJSON()).toEqual(original);
  editor.finish(); expect(editor.getState().canUndo).toBe(true);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getAppearance().vertex.radius).toBe(9);
  editor.destroy(); expect(border()).toBeNull(); expect(Object.keys(map.getStyle().sources)).toEqual([]);
  expect(() => editor.setAppearance({})).toThrow('destroyed');
  editor = new GeometryEditor(map); expect(editor.getAppearance().vertex.radius).toBe(5);
});

it('updates both split fill colors and keeps styling out of the result geometry', async () => {
  await fixture(); const original = editor.exportGeoJSON(); editor.splitSelected();
  editor.setSplitLine([coordinate(250, 50), coordinate(250, 400)]);
  await expect.poll(() => border()).not.toBeNull(); const split = editor.getSplitPreview();
  editor.setAppearance({ draft: { fillColor: '#abc', secondaryFillColor: '#def', lineColor: '#123' } });
  expect(map.getPaintProperty(layerId('-draft-fill'), 'fill-color')).toEqual(['case', ['==', ['get', 'part'], 1], '#def', '#abc']);
  expect(editor.getSplitPreview()).toEqual(split); expect(editor.exportGeoJSON()).toEqual(original);
  editor.finishSplit(); expect(editor.exportGeoJSON().features).toHaveLength(2); editor.undo();
  expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getAppearance().draft.secondaryFillColor).toBe('#def');
});

it('configures snap and pivot markers without changing snapping or transform behavior', async () => {
  await fixture(); editor.setSnapping({ enabled: true }); editor.draw('LineString');
  await click(550, 350); await commands.vertexPointer('move', 106, 104);
  await expect.poll(() => editor.getSnap()?.kind).toBe('vertex'); const snapped = editor.getSnap();
  editor.setAppearance({ snap: { radius: 12, edgeRadius: 9, color: '#123', opacity: 0.6 }, pivot: { radius: 10, color: '#456', strokeColor: '#789' } });
  expect(editor.getSnap()).toEqual(snapped);
  expect(map.getPaintProperty(layerId('-snap'), 'circle-radius')).toEqual(['case', ['==', ['get', 'snapKind'], 'vertex'], 12, 9]);
  expect(map.getPaintProperty(layerId('-snap'), 'circle-opacity')).toBe(0.6);
  editor.cancel(); editor.select('area'); editor.rotateSelection(); editor.setRotationAngle(20);
  await expect.poll(() => border()).not.toBeNull(); const rotated = editor.getRotationPreview();
  expect(map.getPaintProperty(layerId('-transform-pivot'), 'circle-color')).toBe('#456');
  editor.setAppearance({ draft: { lineColor: '#999' } });
  expect(editor.getRotationPreview()).toEqual(rotated); expect(border()!.getAttribute('stroke')).toBe('#999');
});

it('updates a live drag and its delayed committed-source bridge without losing the preview', async () => {
  await fixture(); const original = editor.exportGeoJSON();
  await commands.vertexPointer('down', 200, 200); await commands.vertexPointer('move', 240, 230);
  await expect.poll(() => border('translation-preview')).not.toBeNull();
  editor.setAppearance({ draft: { lineColor: '#456', fillColor: '#abc', fillOpacity: 0.5, lineWidth: 5 } });
  expect(border('translation-preview')!.getAttribute('stroke')).toBe('#456');
  expect(container.querySelector('[data-geo-translation-preview] [data-geo-fill]')!.getAttribute('fill')).toBe('#abc');
  expect(editor.exportGeoJSON()).toEqual(original);
  const committed = source('-features'); const upload = committed.setData.bind(committed);
  let resume: (() => void) | undefined;
  vi.spyOn(committed, 'setData').mockImplementationOnce((data) => new Promise<void>((resolve, reject) => {
    resume = () => { void upload(data).then(resolve, reject); };
  }));
  await commands.vertexPointer('up', 270, 250); const moved = editor.exportGeoJSON();
  expect(moved).not.toEqual(original);
  editor.setAppearance({ draft: { lineColor: '#789', fillOpacity: 0.3 }, selected: { fillColor: '#def' } });
  expect(border('translation-preview')!.getAttribute('stroke')).toBe('#789');
  expect(map.getFeatureState({ source: layerId('-features'), id: '"area"' })).toMatchObject({ editing: true });
  resume!(); await expect.poll(() => border('translation-preview')).toBeNull();
  expect(editor.exportGeoJSON()).toEqual(moved); editor.undo(); expect(editor.exportGeoJSON()).toEqual(original);
  expect(editor.getAppearance().draft.lineColor).toBe('#789');
});

it('supports the legacy facade and isolates different editor instances', async () => {
  editor.setAppearance({ feature: { lineColor: '#123' } });
  const otherContainer = document.createElement('div'); otherContainer.style.cssText = 'width:400px;height:300px'; document.body.append(otherContainer);
  const otherMap = new Map({ container: otherContainer, style: style() });
  await new Promise<void>((resolve) => { otherMap.once('load', () => { resolve(); }); });
  const options: EditorAppearanceOptions = { feature: { lineColor: '#abc' } };
  const legacy = new LineEditor(otherMap, { appearance: options });
  try {
    legacy.setAppearance({ vertex: { radius: 10 } });
    expect(legacy.getAppearance().feature.lineColor).toBe('#abc'); expect(legacy.getAppearance().vertex.radius).toBe(10);
    expect(editor.getAppearance().feature.lineColor).toBe('#123'); expect(editor.getAppearance().vertex.radius).toBe(5);
    legacy.destroy(); expect(() => legacy.setAppearance({})).toThrow('destroyed');
  } finally { legacy.destroy(); otherMap.remove(); otherContainer.remove(); }
});
