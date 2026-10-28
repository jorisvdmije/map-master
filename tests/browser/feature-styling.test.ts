import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GeometryEditor, type Coordinate, type EditorStylingOptions, type GeometryFeature, type PolygonFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] });
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const errors: string[] = [];
const layer = (suffix: string) => map.getStyle().layers.find(layer => layer.id.endsWith(suffix))!.id;
const source = (suffix: string) => map.getSource<GeoJSONSource>(Object.keys(map.getStyle().sources).find(id => id.endsWith(suffix))!)!;
const point = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const box = (id: string | number, x: number, y: number, color: string, order: number): PolygonFeature => ({ type: 'Feature', id, properties: { color, order },
  geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 240, y], [x + 240, y + 200], [x, y + 200], [x, y]].map(([x, y]) => point(x!, y!))] } });
const colorOf = (feature: GeometryFeature): string => typeof feature.properties?.color === 'string' ? feature.properties.color : '#000';
const options = (): EditorStylingOptions => ({ feature: feature => ({ shape: { fillColor: colorOf(feature), fillOpacity: 0.4 }, sortKey: Number(feature.properties?.order) }),
  selected: { shape: { lineWidth: 8, lineColor: '#0000ff' } }, overlap: { enabled: true, opacity: 0.6 } });
const hits = () => map.queryRenderedFeatures([300, 220], { layers: [layer('-overlap-stripes')] });
async function fixture(): Promise<void> {
  const rendered = map.once('idle');
  editor.setStyling(options());
  editor.importGeoJSON({ type: 'FeatureCollection', features: [box(7, 100, 100, '#ff0000', 20), box('7', 220, 100, '#00ff00', 10), box('c', 180, 180, '#0000ff', 30)] });
  editor.clearHistory();
  await rendered;
  expect(hits().length).toBeGreaterThan(0);
}
beforeEach(async () => {
  errors.length = 0; container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true } });
  map.on('error', event => { errors.push(event.error.message); });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); }); editor = new GeometryEditor(map);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); expect(errors).toEqual([]); });

it('renders all three member colors, keeps typed picking and stable patterns through selection', async () => {
  await fixture(); const before = editor.exportGeoJSON(); const pattern: unknown = hits()[0]!.properties.pattern;
  expect(pattern).toContain('#00ff00'); expect(pattern).toContain('#ff0000'); expect(pattern).toContain('#0000ff');
  expect(editor.queryFeatures({ x: 300, y: 220 }).map(feature => feature.id)).toEqual(['c', 7, '7']);
  const callback = vi.fn(options().feature); editor.setStyling({ ...options(), feature: callback }); callback.mockClear();
  const upload = vi.spyOn(source('-features'), 'setData'); const cells = vi.spyOn(source('-styled-areas'), 'setData');
  editor.select(7); editor.select('7'); editor.selectMany(['c', 7]);
  expect(callback).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled(); expect(cells).not.toHaveBeenCalled();
  expect(hits()[0]!.properties.pattern).toBe(pattern); expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getState().canUndo).toBe(false);
  expect(map.getPaintProperty(layer('-fill'), 'fill-opacity')).toBe(0);
  expect(map.getPaintProperty(layer('-styled-fill'), 'fill-color')).toEqual(['case', ['boolean', ['feature-state', 'selected'], false],
    ['coalesce', ['get', '__geo_editor_style_shape_fillColor'], '#116b5b'], ['coalesce', ['get', '__geo_editor_style_shape_fillColor'], '#116b5b']]);
});

it('supports fixed and category-dependent palettes, dimensions and live external rules', async () => {
  await fixture(); const before = editor.exportGeoJSON();
  let color = '#123456'; const palette = vi.fn(() => [color, '#abcdef']);
  editor.setStyling({ ...options(), overlap: { enabled: true, palette, stripeWidth: 20, direction: 'descending', opacity: 0.5 } });
  await expect.poll(() => String(hits()[0]?.properties.pattern)).toContain('#123456');
  expect(map.getPaintProperty(layer('-overlap-stripes'), 'fill-opacity')).toBe(0.5);
  expect(palette.mock.calls.length).toBeGreaterThan(0);
  color = '#654321'; editor.refreshStyling();
  await expect.poll(() => String(hits()[0]?.properties.pattern)).toContain('#654321');
  const config = editor.getStyling(); config.selected!.shape!.lineWidth = 1;
  expect(editor.getStyling().selected?.shape?.lineWidth).toBe(8);
  editor.setStyling({ ...options(), overlap: { enabled: true, palette: ['#f0f', '#0ff'] } });
  await expect.poll(() => String(hits()[0]?.properties.pattern)).toContain('#f0f');
  expect(editor.exportGeoJSON()).toEqual(before); expect(editor.getStylingIssues()).toEqual([]);
});

it('recomputes committed overlaps after edit/Undo while suspending stripes during previews', async () => {
  await fixture(); const original = editor.exportGeoJSON(); editor.select(7); editor.editSelected();
  await expect.poll(() => map.getLayoutProperty(layer('-overlap-stripes'), 'visibility')).toBe('none');
  editor.moveVertex(0, point(70, 80)); editor.cancel();
  await expect.poll(() => hits().length).toBeGreaterThan(0); expect(editor.exportGeoJSON()).toEqual(original);
  editor.selectMany([7, '7', 'c']); editor.translateSelection([0.05, 0]);
  await expect.poll(() => hits().length).toBe(0); editor.undo();
  await expect.poll(() => hits().length).toBeGreaterThan(0); expect(editor.exportGeoJSON()).toEqual(original);
  editor.deleteSelection(); await expect.poll(() => hits().length).toBe(0);
  editor.undo(); await expect.poll(() => hits().length).toBeGreaterThan(0);
});

it('restores rules, textures, selection and lifecycle resources after replacing the map style', async () => {
  await fixture(); editor.select(7); const oldImages = map.listImages(); expect(oldImages.length).toBeGreaterThan(0);
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); });
  map.setStyle(style(), { diff: false });
  editor.setStyling({ ...options(), overlap: { enabled: true, palette: ['#456', '#abc'] } });
  await loaded; await expect.poll(() => String(hits()[0]?.properties.pattern)).toContain('#456');
  expect(editor.getState().selectedFeatureIds).toEqual([7]); expect(editor.getStylingIssues()).toEqual([]);
  editor.destroy(); expect(Object.keys(map.getStyle().sources)).toEqual([]); expect(map.listImages()).toEqual([]);
  expect(() => editor.refreshStyling()).toThrow('destroyed'); editor = new GeometryEditor(map);
});

it('rejects invalid settings atomically and isolates throwing/mutating rule callbacks from data', async () => {
  await fixture(); const original = editor.exportGeoJSON(); const config = editor.getStyling(); const changed = vi.fn(); editor.onChange(changed);
  expect(() => editor.setStyling({ overlap: { enabled: true, stripeWidth: -1 } })).toThrow();
  expect(editor.getStyling()).toEqual(config); expect(changed).not.toHaveBeenCalled();
  editor.setStyling({ feature: feature => { feature.geometry.coordinates = [] as never; if (feature.id === 7) throw new Error('Host rule failed'); return { shape: { fillColor: '#123' } }; },
    overlap: { enabled: true, palette: () => { throw new Error('Host palette failed'); } } });
  expect(editor.getStylingIssues()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'feature', featureId: 7 }), expect.objectContaining({ kind: 'overlap' })]));
  expect(map.getLayoutProperty(layer('-overlap-stripes'), 'visibility')).toBe('none'); expect(editor.exportGeoJSON()).toEqual(original);
  editor.setStyling(options()); await expect.poll(() => hits().length).toBeGreaterThan(0); expect(editor.getStylingIssues()).toEqual([]);
});

it('keeps property-derived colors through duplication, split, union and history', async () => {
  await fixture(); const original = editor.exportGeoJSON(); editor.select(7);
  editor.duplicateSelection([0.015, 0]); expect(editor.getSelection()[0]!.properties?.color).toBe('#ff0000'); editor.undo();
  editor.select(7); editor.splitSelected(); editor.setSplitLine([point(200, 50), point(200, 350)]); expect(editor.finishSplit()).not.toBeNull();
  expect(editor.exportGeoJSON().features.filter(feature => feature.properties?.color === '#ff0000')).toHaveLength(2); editor.undo();
  editor.selectMany([7, '7']); editor.unionSelection(); editor.finishUnion();
  expect(editor.getSelected()?.properties?.color).toBe('#ff0000'); editor.undo();
  expect(editor.exportGeoJSON()).toEqual(original); await expect.poll(() => hits().length).toBeGreaterThan(0);
});

it('styles lines and markers without reading implicit property names and can reset all rules', async () => {
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'p', properties: { color: '#ff0000', __geo_editor_style: { marker_color: '#bad' } }, geometry: { type: 'Point', coordinates: point(300, 200) } },
    { type: 'Feature', id: 'l', properties: { color: '#00ff00' }, geometry: { type: 'LineString', coordinates: [point(100, 100), point(500, 100)] } },
  ] }); editor.clearHistory(); const original = editor.exportGeoJSON();
  editor.setStyling({ feature: feature => ({ marker: { color: colorOf(feature) }, shape: { lineColor: colorOf(feature) } }), selected: {} });
  const rendered = await source('-features').getData();
  expect((rendered as GeoJSON.FeatureCollection).features[0]?.properties?.__geo_editor_style_marker_color).toBe('#ff0000');
  editor.setStyling({}); expect(map.getPaintProperty(layer('-markers'), 'circle-color')).toEqual(['case', ['boolean', ['feature-state', 'selected'], false], '#2563eb', '#116b5b']);
  expect(editor.exportGeoJSON()).toEqual(original); expect(editor.getState().canUndo).toBe(false);
});

it('paints actual single-area colors and once-composited stripe opacity', async () => {
  await fixture();
  const pixel = async (x: number, y: number): Promise<number[]> => {
    await new Promise<void>(resolve => { map.once('render', () => { resolve(); }); map.triggerRepaint(); });
    const canvas = map.getCanvas(); const gl = canvas.getContext('webgl2')!;
    const bytes = new Uint8Array(4);
    gl.readPixels(Math.round(x * canvas.width / 700), Math.round((500 - y) * canvas.height / 500), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return [...bytes];
  };
  await expect.poll(async () => (await pixel(140, 140)).slice(0, 3)).toEqual([255, 153, 153]);
  // Red/green/blue stripes at 60% over white have two channels near 102, never
  // the dark mixture that results from drawing over the original overlapping fills.
  const stripe = (await pixel(300, 230)).slice(0, 3).sort((a, b) => a - b);
  expect(stripe[0]).toBeCloseTo(102, -1); expect(stripe[1]).toBeCloseTo(102, -1); expect(stripe[2]).toBe(255);
});

it('clears old selection state when overlap is re-enabled and reuses geometry on camera changes', async () => {
  await fixture(); editor.select(7); const position = point(300, 220);
  editor.setStyling({}); editor.select('7'); editor.setStyling(options());
  const id = Object.keys(map.getStyle().sources).find(id => id.endsWith('-styled-areas'))!;
  expect(map.getFeatureState({ source: id, id: '7' })).not.toHaveProperty('selected');
  expect(map.getFeatureState({ source: id, id: JSON.stringify('7') })).toMatchObject({ selected: true });
  const resolver = vi.fn(options().feature); editor.setStyling({ ...options(), feature: resolver }); resolver.mockClear();
  const upload = vi.spyOn(source('-styled-areas'), 'setData');
  map.jumpTo({ bearing: 27, pitch: 35, zoom: 14.3 });
  await expect.poll(() => map.queryRenderedFeatures(map.project(position), { layers: [layer('-overlap-stripes')] }).length).toBeGreaterThan(0);
  expect(resolver).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
});

it('rejects invalid constructor styling and prunes obsolete textures on idle', async () => {
  editor.destroy();
  expect(() => new GeometryEditor(map, { styling: { overlap: { palette: [] } } })).toThrow();
  expect(Object.keys(map.getStyle().sources)).toEqual([]);
  editor = new GeometryEditor(map); await fixture();
  const idle = new Promise<void>(resolve => { map.once('idle', () => { resolve(); }); });
  editor.setStyling({ ...options(), overlap: { enabled: true, palette: ['#abcdef', '#123456'] } });
  await idle;
  expect(map.listImages()).toHaveLength(1); expect(map.listImages()[0]).toContain('#abcdef');
});
