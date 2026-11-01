import { Map, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  EditorToolbar, GeometryEditor, type FeatureId, type GeometryFeature, type LineFeature, type PolygonFeature, type ToolbarTool,
} from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
// The toolbar injects its styles and places its panel once MapLibre has inserted it.
const settle = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });
const button = (tool: ToolbarTool) => container.querySelector<HTMLButtonElement>(`.mm-toolbar-button[data-tool="${tool}"]`)!;
const panel = () => container.querySelector<HTMLElement>('.mm-toolbar-actions')!;
const action = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('.mm-toolbar-action')].find((b) => b.textContent === text)!;
const shown = (element: Element) => element.checkVisibility();
const field = () => container.querySelector<HTMLInputElement>('.mm-toolbar-field input')!;
const enabled = () => [...container.querySelectorAll<HTMLButtonElement>('.mm-toolbar-button')].filter((b) => !b.disabled).map((b) => b.dataset.tool);
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const at = (x: number, y: number) => map.unproject([x, y]).toArray();
const line = (id: FeatureId, y: number): LineFeature => ({ type: 'Feature', id, properties: {},
  geometry: { type: 'LineString', coordinates: [at(250, y), at(550, y)] },
});
const square = (id: FeatureId, x: number, y: number, size = 100): PolygonFeature => ({ type: 'Feature', id, properties: {},
  geometry: { type: 'Polygon', coordinates: [[at(x, y + size), at(x + size, y + size), at(x + size, y), at(x, y), at(x, y + size)]] },
});
const courtyards = (): PolygonFeature => ({ ...square('courtyards', 100, 100, 300), properties: { name: 'Courtyards' },
  geometry: { type: 'Polygon', coordinates: [square('outer', 100, 100, 300).geometry.coordinates[0]!,
    square('hole-a', 150, 150, 50).geometry.coordinates[0]!, square('hole-b', 300, 300, 50).geometry.coordinates[0]!] },
});
const holeChoice = () => container.querySelector<HTMLSelectElement>('.mm-toolbar-hole select')!;
const load = (...features: GeometryFeature[]) => { editor.importGeoJSON({ type: 'FeatureCollection', features }); editor.clearHistory(); };
const add = async (toolbar: EditorToolbar, position?: 'top-left' | 'top-right' | 'bottom-left') => {
  map.addControl(toolbar, position); await settle(); return toolbar;
};

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:500px;position:relative;';
  document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 13, fadeDuration: 0,
    style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] } });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { editor.destroy(); map.remove(); container.remove(); });

it('renders the default tools as a styled, labelled MapLibre control', async () => {
  await add(new EditorToolbar(editor));
  const root = container.querySelector<HTMLElement>('.maplibregl-ctrl-top-left .mm-toolbar')!;
  expect(root.getAttribute('role')).toBe('toolbar');
  expect(root.getAttribute('aria-label')).toBe('Geometry tools');
  expect([...root.querySelectorAll<HTMLButtonElement>('.mm-toolbar-button')].map((b) => b.dataset.tool)).toEqual(EditorToolbar.defaultTools);
  expect([...root.querySelectorAll('.mm-toolbar-group')].map((group) => group.children.length)).toEqual([3, 7, 2]);
  expect(button('polygon').getAttribute('aria-label')).toBe('Draw polygon');
  expect(button('polygon').getAttribute('aria-pressed')).toBe('false');
  expect(button('undo').hasAttribute('aria-pressed')).toBe(false);
  expect(button('polygon').querySelector('svg')!.childElementCount).toBeGreaterThan(0);
  expect(getComputedStyle(button('polygon')).width).toBe('32px');
  expect(shown(panel())).toBe(false);
  expect(enabled()).toEqual(['point', 'line', 'polygon']);
  expect(new EditorToolbar(editor).getDefaultPosition()).toBe('top-left');
  expect(document.adoptedStyleSheets.filter((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('.mm-toolbar')))).toHaveLength(1);
});

it('draws, removes the last point, finishes and replays history from the toolbar', async () => {
  await add(new EditorToolbar(editor));
  await userEvent.click(button('polygon'));
  expect(editor.getState().mode).toBe('draw-polygon');
  expect(button('polygon').getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(map.getCanvas());
  expect(shown(panel())).toBe(true);
  expect(action('Finish').disabled).toBe(true);
  expect(action('Remove last point').disabled).toBe(true);
  expect(panel().getBoundingClientRect().left).toBeGreaterThan(button('polygon').getBoundingClientRect().right);

  await click(150, 150); await click(350, 150); await click(350, 350); await click(200, 380);
  expect(button('line').disabled).toBe(true);
  await userEvent.click(action('Remove last point'));
  expect(editor.getState().vertexCount).toBe(3);
  await userEvent.click(action('Finish'));
  expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 1, canUndo: true });
  expect(shown(panel())).toBe(false);
  expect(button('polygon').getAttribute('aria-pressed')).toBe('false');

  await userEvent.click(button('undo'));
  expect(editor.getState().featureCount).toBe(0);
  await userEvent.click(button('redo'));
  expect(editor.getState().featureCount).toBe(1);
  expect(button('redo').disabled).toBe(true);
});

it('switches drawing tools while no point is placed and cancels the active tool when pressed again', async () => {
  await add(new EditorToolbar(editor));
  await userEvent.click(button('polygon'));
  await userEvent.click(button('line'));
  expect(editor.getState().mode).toBe('draw-line');
  expect(shown(action('Finish'))).toBe(true);
  expect(shown(container.querySelector('.mm-toolbar-field')!)).toBe(false);
  await userEvent.click(button('line'));
  expect(editor.getState().mode).toBe('idle');

  await userEvent.click(button('point'));
  expect(shown(action('Finish'))).toBe(false);
  expect(shown(action('Remove last point'))).toBe(false);
  expect(shown(action('Cancel'))).toBe(true);
  await click(300, 300);
  expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 1 });
});

it('enables each tool only for a qualifying, unlocked selection', async () => {
  load(square('a', 100, 100), square('b', 150, 150), line('l', 400));
  await add(new EditorToolbar(editor, { tools: EditorToolbar.allTools }));
  const shapes = ['point', 'text', 'template', 'line', 'polygon', 'rectangle', 'circle', 'ellipse', 'freehand'];
  const aids = ['guides', 'snapping', 'constraints', 'tracing', 'measure', 'zoom'];
  expect(enabled()).toEqual([...shapes, 'lasso', 'cut', ...aids]);
  editor.select('a');
  expect(enabled()).toEqual([...shapes, 'hole', 'part', 'lasso', 'edit', 'split', 'cut', 'reshape', 'rotate', 'scale', 'buffer', 'simplify', 'duplicate', 'delete', ...aids]);
  editor.selectMany(['a', 'b']);
  expect(enabled()).toEqual([...shapes, 'lasso', 'cut', 'shared-boundary', 'union', 'difference', 'intersection', 'combine', 'rotate', 'scale', 'buffer', 'simplify', 'duplicate', 'delete', ...aids]);
  editor.select('l');
  expect(enabled()).toEqual([...shapes, 'part', 'lasso', 'edit', 'cut', 'rotate', 'scale', 'buffer', 'offset', 'simplify', 'duplicate', 'delete', ...aids]);
  editor.setLockedFeatureIds(['l']);
  expect(enabled()).toEqual([...shapes, 'lasso', 'duplicate', ...aids]);

  editor.setLockedFeatureIds([]); editor.selectMany(['a', 'b']);
  await userEvent.click(button('union'));
  expect(editor.getState().mode).toBe('union-polygons');
  expect(action('Apply').disabled).toBe(false);
  // A preview discards no input, so another qualifying tool takes over directly.
  await userEvent.click(button('intersection'));
  expect(editor.getState().mode).toBe('intersection-polygons');
  await userEvent.click(action('Cancel'));
  expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 3 });
});

it('chooses an original hole on the map and applies one transaction with exact undo/redo', async () => {
  load(courtyards()); editor.select('courtyards');
  const before = editor.exportGeoJSON(); const changes: string[] = [];
  editor.onDataChange((event) => { changes.push(event.source); });
  map.getCanvas().style.cursor = 'help'; map.doubleClickZoom.disable();
  await add(new EditorToolbar(editor, { tools: ['remove-hole', 'undo', 'redo'] }));
  await userEvent.click(button('remove-hole'));
  expect(editor.getState()).toMatchObject({ mode: 'remove-hole', activeRingIndex: 1, canFinish: true });
  expect(button('remove-hole').getAttribute('aria-pressed')).toBe('true');
  expect(holeChoice().value).toBe('0:1');
  expect([...holeChoice().options].map((option) => option.text)).toEqual(['Part 1 · Hole 1', 'Part 1 · Hole 2']);
  await click(325, 325);
  expect(holeChoice().value).toBe('0:2');
  await click(450, 450);
  expect(editor.getState().activeRingIndex).toBe(2);
  await click(175, 175); // The first hole is still selectable from the original geometry.
  expect(editor.getState().activeRingIndex).toBe(1);
  expect(editor.exportGeoJSON()).toEqual(before); expect(changes).toEqual([]);
  await userEvent.click(action('Apply'));
  expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: ['courtyards'], canUndo: true });
  expect(changes).toEqual(['transaction']);
  const after = editor.exportGeoJSON();
  expect((editor.getSelected() as PolygonFeature).geometry.coordinates).toHaveLength(2);
  expect(map.getCanvas().style.cursor).toBe('help'); expect(map.doubleClickZoom.isEnabled()).toBe(false);
  await userEvent.click(button('undo')); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.click(button('redo')); expect(editor.exportGeoJSON()).toEqual(after);
});

it('selects a hole by keyboard, cancels without changes and respects selection and locks', async () => {
  load(courtyards(), square('solid', 450, 150));
  await add(new EditorToolbar(editor, { tools: ['remove-hole', 'undo'] }));
  expect(button('remove-hole').disabled).toBe(true);
  editor.select('solid'); expect(button('remove-hole').disabled).toBe(true);
  editor.selectMany(['solid', 'courtyards']); expect(button('remove-hole').disabled).toBe(true);
  editor.select('courtyards'); editor.setLockedFeatureIds(['courtyards']);
  expect(button('remove-hole').disabled).toBe(true);
  editor.setLockedFeatureIds([]); const before = editor.exportGeoJSON();
  editor.removeHole();
  await userEvent.selectOptions(holeChoice(), '0:2');
  expect(editor.getState().activeRingIndex).toBe(2);
  holeChoice().focus(); await userEvent.keyboard('{Escape}');
  expect(editor.getState().mode).toBe('idle'); expect(editor.exportGeoJSON()).toEqual(before);
  expect(editor.getState().canUndo).toBe(false);
  editor.removeHole(); editor.setLockedFeatureIds(['courtyards']);
  expect(editor.getState().mode).toBe('idle'); expect(shown(panel())).toBe(false);
  expect(editor.exportGeoJSON()).toEqual(before);
  editor.setLockedFeatureIds([]); editor.removeHole();
  container.style.width = '320px'; map.resize();
  const panelBounds = panel().getBoundingClientRect(); const mapBounds = map.getCanvas().getBoundingClientRect();
  expect(panelBounds.right).toBeLessThanOrEqual(mapBounds.right);
  expect(panelBounds.height).toBeGreaterThan(32);
  await userEvent.click(button('remove-hole'));
  expect(editor.getState().mode).toBe('idle');
  editor.removeHole(); map.getCanvas().focus(); await userEvent.keyboard('{Enter}');
  expect((editor.getSelected() as PolygonFeature).geometry.coordinates).toHaveLength(2);
});

it('explains invalid multipolygon filling and lets a different ring be applied', async () => {
  const feature = courtyards();
  load({ ...feature, geometry: { type: 'MultiPolygon', coordinates: [feature.geometry.coordinates,
    square('island', 160, 160, 20).geometry.coordinates,
    [square('second', 450, 150, 100).geometry.coordinates[0]!, square('third-hole', 470, 170, 40).geometry.coordinates[0]!],
  ] } });
  editor.select('courtyards'); const before = editor.exportGeoJSON();
  await add(new EditorToolbar(editor, { tools: ['remove-hole'], labels: { holeChoice: 'Gat', holeNumber: 'Gat', partNumber: 'Deel' } }));
  editor.removeHole();
  expect(holeChoice().options[2]!.text).toBe('Deel 3 · Gat 1');
  expect(action('Apply').disabled).toBe(true);
  expect(holeChoice().getAttribute('aria-invalid')).toBe('true');
  expect(shown(container.querySelector('.mm-toolbar-notice')!)).toBe(true);
  expect(editor.finish()).toBeNull(); expect(editor.exportGeoJSON()).toEqual(before);
  await click(490, 190);
  expect(holeChoice().value).toBe('2:1');
  expect(action('Apply').disabled).toBe(false);
  expect(shown(container.querySelector('.mm-toolbar-notice')!)).toBe(false);
  holeChoice().focus(); await userEvent.keyboard('{Enter}');
  const after = editor.getSelected()!;
  if (after.geometry.type !== 'MultiPolygon') throw new Error('Expected MultiPolygon');
  expect(after.geometry.coordinates[0]).toEqual((before.features[0]!.geometry as typeof after.geometry).coordinates[0]);
  expect(after.geometry.coordinates[2]).toHaveLength(1);
});

it('applies a buffer distance from the panel and blocks invalid values', async () => {
  load(square('a', 250, 150));
  editor.select('a');
  await add(new EditorToolbar(editor, { tools: ['buffer', 'undo'] }));
  await userEvent.click(button('buffer'));
  expect(editor.getState().mode).toBe('buffer-features');
  expect(container.querySelector('.mm-toolbar-field')!.textContent).toBe('Distancem');
  expect(shown(action('Remove last point'))).toBe(false);
  expect(shown(field())).toBe(true);
  expect(field().value).toBe('10');
  await userEvent.fill(field(), '25');
  expect(editor.getState().bufferDistance).toBe(25);
  await userEvent.fill(field(), '-5');
  expect(field().getAttribute('aria-invalid')).toBe('true');
  expect(action('Apply').disabled).toBe(true);
  expect(editor.getState().bufferDistance).toBe(25);
  await userEvent.fill(field(), '30');
  expect(field().getAttribute('aria-invalid')).toBe('false');
  await userEvent.click(action('Apply'));
  expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: true });
  const ring = (editor.getFeature('a') as PolygonFeature).geometry.coordinates[0]!;
  expect(ring.length).toBeGreaterThan(5);
});

it('rotates with the angle field, applying with Enter and cancelling with Escape', async () => {
  load(square('a', 250, 150));
  editor.select('a');
  await add(new EditorToolbar(editor, { tools: ['rotate'] }));
  const original = editor.getFeature('a');
  await userEvent.click(button('rotate'));
  expect(field().value).toBe('0');
  await userEvent.fill(field(), '45');
  expect(editor.getState().rotationAngle).toBe(45);
  await userEvent.keyboard('{Enter}');
  expect(editor.getState().mode).toBe('idle');
  const rotated = editor.getFeature('a');
  expect(rotated).not.toEqual(original);

  await userEvent.click(button('rotate'));
  await userEvent.fill(field(), '30');
  await userEvent.keyboard('{Escape}');
  expect(editor.getState().mode).toBe('idle');
  expect(editor.getFeature('a')).toEqual(rotated);
});

it('toggles snapping, angle constraints and tracing and reflects changes made through the API', async () => {
  await add(new EditorToolbar(editor, { tools: ['snapping', 'constraints', 'tracing'] }));
  expect(button('snapping').getAttribute('aria-pressed')).toBe('false');
  editor.setSnapping({ enabled: true });
  expect(button('snapping').getAttribute('aria-pressed')).toBe('true');
  editor.setSnapping({ enabled: false });
  await userEvent.click(button('tracing'));
  expect(editor.getTracing().enabled).toBe(true);
  expect(editor.getSnapping().enabled).toBe(true);
  expect(button('snapping').getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(button('constraints'));
  expect(editor.getDrawingConstraints().enabled).toBe(true);
  expect(document.activeElement).toBe(button('constraints'));
});

it('duplicates the selection beside the original and deletes it', async () => {
  load(square('a', 250, 150));
  editor.select('a');
  await add(new EditorToolbar(editor, { tools: ['duplicate', 'delete'] }));
  await userEvent.click(button('duplicate'));
  expect(editor.getState().featureCount).toBe(2);
  const [copy] = editor.getSelection() as PolygonFeature[];
  const corner = map.project(copy!.geometry.coordinates[0]![0] as [number, number]);
  expect(corner.x).toBeCloseTo(274, 0);
  expect(corner.y).toBeCloseTo(274, 0);
  await userEvent.click(button('delete'));
  expect(editor.getState()).toMatchObject({ featureCount: 1, selectedFeatureIds: [] });
  expect(editor.getFeature('a')).not.toBeNull();
});

it('opens the panel towards the map centre when placed on the right', async () => {
  await add(new EditorToolbar(editor, { tools: ['point', 'line', 'polygon'] }), 'top-right');
  await userEvent.click(button('polygon'));
  expect(container.querySelector('.mm-toolbar')!.classList.contains('mm-toolbar--end')).toBe(true);
  const panelBox = panel().getBoundingClientRect();
  const buttonBox = button('polygon').getBoundingClientRect();
  expect(panelBox.right).toBeLessThan(buttonBox.left);
  expect(Math.abs(panelBox.top - buttonBox.top)).toBeLessThan(1);
});

it('moves focus with arrow keys and keeps one tab stop', async () => {
  await add(new EditorToolbar(editor));
  const tabStops = () => [...container.querySelectorAll<HTMLButtonElement>('.mm-toolbar-button')].filter((b) => b.tabIndex === 0);
  expect(tabStops()).toEqual([button('point')]);
  button('point').focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(button('line'));
  await userEvent.keyboard('{End}');
  expect(document.activeElement).toBe(button('polygon'));
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(button('point'));
});

it('accepts translated labels and rejects invalid options', async () => {
  await add(new EditorToolbar(editor, { tools: ['polygon'], labels: { polygon: 'Vlak tekenen', finish: 'Klaar', toolbar: 'Gereedschap' } }));
  expect(button('polygon').getAttribute('aria-label')).toBe('Vlak tekenen');
  expect(button('polygon').dataset.tooltip).toBe('Vlak tekenen');
  expect(container.querySelector('.mm-toolbar')!.getAttribute('aria-label')).toBe('Gereedschap');
  await userEvent.click(button('polygon'));
  expect(action('Klaar')).toBeDefined();

  expect(() => new EditorToolbar(editor, { tools: [] })).toThrow(TypeError);
  expect(() => new EditorToolbar(editor, { tools: ['polygon', 'polygon'] })).toThrow('Repeated toolbar tool: polygon');
  expect(() => new EditorToolbar(editor, { tools: ['hexagon' as ToolbarTool] })).toThrow('Unknown toolbar tool: hexagon');
  expect(() => new EditorToolbar(editor, { labels: { hexagon: 'Hexagon' } as never })).toThrow('Unknown toolbar label: hexagon');
  expect(() => new EditorToolbar(editor, { labels: { polygon: 1 as unknown as string } })).toThrow(TypeError);
});

it('removes its element and stops following the editor', async () => {
  const first = await add(new EditorToolbar(editor));
  await add(new EditorToolbar(editor, { tools: ['undo'] }), 'bottom-left');
  map.removeControl(first);
  expect(container.querySelectorAll('.mm-toolbar')).toHaveLength(1);
  editor.draw('Polygon');
  editor.cancel();
  expect(container.querySelectorAll('.mm-toolbar')).toHaveLength(1);
});

it('shows the action panel only on the toolbar that holds the active tool', async () => {
  load(square('a', 250, 150));
  await add(new EditorToolbar(editor, { tools: ['polygon', 'edit'] }));
  await add(new EditorToolbar(editor, { tools: ['rotate', 'undo'] }), 'top-right');
  const [left, right] = [...container.querySelectorAll<HTMLElement>('.mm-toolbar-actions')];
  await userEvent.click(button('polygon'));
  expect([shown(left!), shown(right!)]).toEqual([true, false]);
  await userEvent.click(button('polygon'));
  editor.select('a');
  await userEvent.click(button('rotate'));
  expect([shown(left!), shown(right!)]).toEqual([false, true]);
  editor.cancel();
  editor.draw('LineString');
  expect([shown(left!), shown(right!)]).toEqual([false, false]);
});

it('offers shape, part, cut, multipart, measurement and zoom tools', async () => {
  await add(new EditorToolbar(editor, { tools: EditorToolbar.allTools }));
  expect(enabled()).toEqual(['point', 'text', 'template', 'line', 'polygon', 'rectangle', 'circle', 'ellipse', 'freehand', 'lasso', 'guides', 'snapping', 'constraints', 'tracing', 'measure']);
  await userEvent.click(button('rectangle'));
  expect(editor.getState().mode).toBe('draw-rectangle');
  expect(shown(action('Cancel'))).toBe(true);
  expect(shown(action('Finish'))).toBe(false);
  await click(400, 250); // Keep canvas clicks to the right of every tool panel.
  expect(action('Remove last point').disabled).toBe(false);
  await click(500, 320);
  expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 1 });

  load(square('a', 300, 100), square('b', 450, 100), line('route', 400));
  editor.select('a');
  expect(enabled()).toEqual(expect.arrayContaining(['part', 'cut', 'zoom']));
  expect(enabled()).not.toContain('combine');
  expect(enabled()).not.toContain('explode');
  editor.selectMany(['a', 'b']);
  expect(enabled()).toContain('combine');
  await userEvent.click(button('combine'));
  expect(editor.getFeature('a')?.geometry.type).toBe('MultiPolygon');
  expect(button('combine').hasAttribute('aria-pressed')).toBe(false);
  expect(enabled()).toContain('explode');
  await userEvent.click(button('explode'));
  expect(editor.getState().selectedFeatureIds).toHaveLength(2);
  editor.selectMany(['a', 'route']);
  expect(enabled()).not.toContain('combine');

  editor.select('route');
  await userEvent.click(button('part'));
  expect(editor.getState().mode).toBe('draw-part');
  expect(shown(action('Remove last point'))).toBe(true);
  await userEvent.click(action('Cancel'));

  editor.select(null);
  await userEvent.click(button('cut'));
  expect(editor.getState().mode).toBe('draw-cut');
  expect(shown(action('Apply'))).toBe(true);
  await userEvent.click(button('cut'));
  expect(editor.getState().mode).toBe('idle');

  await userEvent.click(button('measure'));
  expect(editor.getMeasurements().enabled).toBe(true);
  expect(button('measure').getAttribute('aria-pressed')).toBe('true');
  const zoom = map.getZoom();
  await userEvent.click(button('zoom'));
  await new Promise<void>((resolve) => { if (!map.isMoving()) resolve(); else map.once('moveend', () => { resolve(); }); });
  expect(map.getZoom()).not.toBe(zoom);
});

it('adds application buttons and collapses', async () => {
  const saved: number[] = [];
  let archived = false;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  await add(new EditorToolbar(editor, {
    tools: ['polygon', 'undo'],
    collapsible: true,
    buttons: [
      { id: 'save', label: 'Save', icon, onClick: (current) => { saved.push(current.getState().featureCount); }, enabled: (state) => state.mode === 'idle' },
      { id: 'archive', label: 'archive', onClick: () => { archived = !archived; }, pressed: () => archived },
    ],
  }));
  const save = button('save' as ToolbarTool);
  const archive = button('archive' as ToolbarTool);
  expect(save.getAttribute('aria-label')).toBe('Save');
  expect(save.querySelector('svg')).not.toBe(icon);
  expect(save.hasAttribute('aria-pressed')).toBe(false);
  expect(archive.textContent).toBe('A');
  expect(archive.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(save);
  expect(saved).toEqual([0]);
  await userEvent.click(archive);
  expect(archive.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(button('polygon'));
  expect(save.disabled).toBe(true);
  editor.cancel();

  const toggle = button('toggle' as ToolbarTool);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.getAttribute('aria-label')).toBe('Hide tools');
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.getAttribute('aria-label')).toBe('Show tools');
  expect(shown(button('polygon'))).toBe(false);
  expect(shown(save)).toBe(false);
  await userEvent.click(toggle);
  expect(shown(button('polygon'))).toBe(true);

  expect(() => new EditorToolbar(editor, { buttons: [{ id: 'undo', label: 'x', onClick: () => undefined }] })).toThrow('Repeated toolbar tool: undo');
  expect(() => new EditorToolbar(editor, { buttons: [{ id: '', label: 'x', onClick: () => undefined }] })).toThrow(TypeError);
  expect(() => new EditorToolbar(editor, { buttons: [{ id: 'x', label: '', onClick: () => undefined }] })).toThrow(TypeError);
  expect(() => new EditorToolbar(editor, { buttons: [{ id: 'x', label: 'x' } as never] })).toThrow(TypeError);
  expect(() => new EditorToolbar(editor, { buttons: [{ id: 'x', label: 'x', onClick: () => undefined, icon: 'svg' as never }] })).toThrow(TypeError);
  expect(() => new EditorToolbar(editor, { buttons: 'save' as never })).toThrow(TypeError);
  const collapsed = await add(new EditorToolbar(editor, { tools: ['point'], collapsible: true, collapsed: true }), 'bottom-left');
  expect(collapsed).toBeDefined();
  expect(container.querySelector('.maplibregl-ctrl-bottom-left .mm-toolbar-button[data-tool="point"]')!.checkVisibility()).toBe(false);
});
