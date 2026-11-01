import { Map, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { EditorToolbar, GeometryEditor, LineEditor, type EditorOptions, type GeometryFeature, type KeyboardShortcuts } from '../../src/index.js';
import { ShortcutBindings } from '../../src/maplibre/shortcut-bindings.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const at = (x: number, y: number) => map.unproject([x, y]).toArray();
const shape = (): GeometryFeature => ({ type: 'Feature', id: 'shape', properties: { name: 'Original' }, geometry: {
  type: 'Polygon', coordinates: [[at(150, 120), at(400, 120), at(400, 330), at(150, 330), at(150, 120)]],
} });
const load = () => { editor.importGeoJSON(shape()); editor.clearHistory(); editor.select('shape'); map.getCanvas().focus(); };
const key = (value: string, init: KeyboardEventInit = {}, target: EventTarget = map.getCanvas()) => {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init }); target.dispatchEvent(event); return event;
};
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const recreate = (options: EditorOptions) => { editor.destroy(); editor = new GeometryEditor(map, options); map.getCanvas().focus(); };

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:480px;position:relative;'; document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 13, fadeDuration: 0,
    style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] } });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map); map.getCanvas().focus();
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('draws, removes points, finishes and replays a custom binding through real keyboard input', async () => {
  recreate({ keyboardShortcuts: { polygon: [{ key: 'p' }], finish: [{ key: 'Enter', modifiers: ['Control'] }], delete: [{ key: 'x' }],
    undo: [{ key: 'u', modifiers: ['Control'] }], redo: [{ key: 'u', modifiers: ['Control', 'Shift'] }] } });
  await userEvent.keyboard('p'); expect(editor.getState().mode).toBe('draw-polygon');
  await click(150, 120); await click(400, 120); await click(400, 330); await click(300, 360);
  await userEvent.keyboard('x'); expect(editor.getDraft()).toHaveLength(3);
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('draw-polygon');
  await userEvent.keyboard('{Control>}{Enter}{/Control}'); const saved = editor.exportGeoJSON();
  expect(saved.features).toHaveLength(1); expect(editor.getState().mode).toBe('idle');
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(saved);
  await userEvent.keyboard('{Control>}u{/Control}'); expect(editor.getState().featureCount).toBe(0);
  await userEvent.keyboard('{Control>}{Shift>}U{/Shift}{/Control}'); expect(editor.exportGeoJSON()).toEqual(saved);
});

it('updates existing listeners and toolbar hints while a draft is active without changing history or data', async () => {
  load(); map.addControl(new EditorToolbar(editor, { tools: ['polygon', 'undo', 'redo'] }));
  const changes = vi.fn(); const data = vi.fn(); editor.onChange(changes); editor.onDataChange(data);
  editor.draw('LineString'); await click(100, 380); await click(400, 380);
  const draft = editor.getDraft(); const revision = editor.getState().dataRevision; changes.mockClear();
  editor.setKeyboardShortcuts({ finish: [{ key: 'f' }], cancel: [{ key: 'c' }], polygon: [{ key: 'p', modifiers: ['Shift'] }] });
  expect(editor.getDraft()).toEqual(draft); expect(changes).toHaveBeenCalledOnce(); expect(data).not.toHaveBeenCalled();
  expect(editor.getState().dataRevision).toBe(revision);
  const polygon = container.querySelector<HTMLButtonElement>('[data-tool="polygon"]')!;
  expect(polygon.dataset.tooltip).toContain('Shift+P'); expect(polygon.getAttribute('aria-keyshortcuts')).toBe('Shift+P');
  await userEvent.keyboard('{Escape}{Enter}'); expect(editor.getDraft()).toEqual(draft);
  await userEvent.keyboard('c'); expect(editor.getState()).toMatchObject({ mode: 'idle', canUndo: false });
  editor.setKeyboardShortcuts({ polygon: false }); expect(polygon.hasAttribute('aria-keyshortcuts')).toBe(false);
  expect(polygon.dataset.tooltip).toBe('Draw polygon');
});

it('keeps old settings, draft and events intact after conflicts and invalid runtime updates', () => {
  load(); editor.editSelected(); const draft = editor.getDraft(); const original = editor.getKeyboardShortcuts();
  const changes = vi.fn(); editor.onChange(changes);
  for (const update of [{ finish: [{ key: 'Escape' }] }, { point: [{ key: 'p', modifiers: ['Super'] }] }, { nope: [] }]) {
    expect(() => editor.setKeyboardShortcuts(update as KeyboardShortcuts)).toThrow(TypeError);
    expect(editor.getKeyboardShortcuts()).toEqual(original); expect(editor.getDraft()).toEqual(draft);
  }
  expect(changes).not.toHaveBeenCalled();
  const snapshot = editor.getKeyboardShortcuts(); snapshot.cancel[0]!.key = 'x'; snapshot.undo.length = 0;
  expect(editor.getKeyboardShortcuts()).toEqual(original);
});

it('ignores text controls, editable content, unrelated focus, composition, AltGraph and prevented events', async () => {
  load(); editor.setKeyboardShortcuts({ delete: [{ key: 'x' }] });
  for (const tag of ['input', 'textarea', 'select', 'button', 'div'] as const) {
    const control = document.createElement(tag); if (tag === 'div') control.contentEditable = 'true';
    container.append(control); control.focus();
    await userEvent.keyboard('x'); expect(editor.getState().featureCount).toBe(1);
    // Dispatching on a canvas without actual focus cannot run a command either.
    expect(key('x').defaultPrevented).toBe(false); control.remove();
  }
  map.getCanvas().focus();
  for (const init of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true }]) {
    expect(key('x', init).defaultPrevented).toBe(false);
  }
  const altGraph = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
  Object.defineProperty(altGraph, 'getModifierState', { value: (modifier: string) => modifier === 'AltGraph' }); map.getCanvas().dispatchEvent(altGraph);
  const prevented = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }); prevented.preventDefault(); map.getCanvas().dispatchEvent(prevented);
  expect(editor.getState().featureCount).toBe(1);
  await userEvent.keyboard('x'); expect(editor.getState().featureCount).toBe(0);
});

it('resolves Mod per platform with exact modifier matching', () => {
  for (const platform of ['MacIntel', 'Win32', 'Linux x86_64']) {
    const bindings = new ShortcutBindings({ polygon: [{ key: 'p', modifiers: ['Mod', 'Shift'] }] }, { platform } as Navigator);
    const apple = platform === 'MacIntel';
    const event = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { key: 'P', shiftKey: true, ...init });
    expect(bindings.matches('polygon', event({ ctrlKey: !apple, metaKey: apple }))).toBe(true);
    expect(bindings.matches('polygon', event({ ctrlKey: apple, metaKey: !apple }))).toBe(false);
    expect(bindings.matches('polygon', event({ ctrlKey: true, metaKey: true }))).toBe(false);
    expect(bindings.matches('polygon', event({ ctrlKey: !apple, metaKey: apple, altKey: true }))).toBe(false);
    expect(bindings.label('polygon')).toBe(apple ? 'Cmd+Shift+P' : 'Ctrl+Shift+P');
  }
  const bindings = new ShortcutBindings({ cancel: [{ key: 'c' }], finish: [{ key: 'c', modifiers: ['Shift'] }] }, window.navigator);
  const shifted = new KeyboardEvent('keydown', { key: 'C', shiftKey: true });
  expect(bindings.matches('cancel', shifted, ['Shift'])).toBe(false);
  expect(bindings.matches('finish', shifted, ['Shift'])).toBe(true);
});

it('activates tools with the same selection and lock policy as the toolbar and protects pending drafts', async () => {
  load(); editor.setKeyboardShortcuts({ edit: [{ key: 'e' }], duplicate: [{ key: 'd' }], lasso: [{ key: 'l' }], snapping: [{ key: 's' }] });
  editor.setLockedFeatureIds(['shape']); expect(key('e').defaultPrevented).toBe(false); expect(editor.getState().mode).toBe('idle');
  await userEvent.keyboard('d'); expect(editor.getState().featureCount).toBe(2); editor.undo();
  editor.setLockedFeatureIds([]); editor.select('shape'); await userEvent.keyboard('e'); expect(editor.getState().mode).toBe('edit-polygon');
  const draft = editor.getDraft(); await userEvent.keyboard('lds'); expect(editor.getState().mode).toBe('edit-polygon'); expect(editor.getDraft()).toEqual(draft);
  editor.cancel(); await userEvent.keyboard('s'); expect(editor.getSnapping().enabled).toBe(true);
  await userEvent.keyboard('l'); expect(editor.getState().mode).toBe('select-lasso');
});

it('remaps repeating feature movement without panning and keeps each committed nudge undoable', async () => {
  load(); const original = editor.exportGeoJSON(); const center = map.getCenter().toArray();
  editor.setKeyboardShortcuts({ 'nudge-right': [{ key: 'j' }], 'nudge-right-fast': [{ key: 'j', modifiers: ['Shift'] }] });
  await userEvent.keyboard('j'); key('j', { repeat: true }); await userEvent.keyboard('{Shift>}J{/Shift}');
  const moved = editor.getSelected()!; if (moved.geometry.type !== 'Polygon') throw new Error('Expected polygon');
  expect(map.project(moved.geometry.coordinates[0]![0]!).x).toBeCloseTo(162, 5); expect(map.getCenter().toArray()).toEqual(center);
  editor.undo(); editor.undo(); editor.undo(); expect(editor.exportGeoJSON()).toEqual(original);
  editor.setLockedFeatureIds(['shape']); expect(key('j').defaultPrevented).toBe(false); expect(editor.exportGeoJSON()).toEqual(original);
});

it('remaps cancel, delete and save in the focused vertex control, including a held movement', async () => {
  load(); editor.setKeyboardShortcuts({ cancel: [{ key: 'c' }], finish: [{ key: 'f' }], delete: [{ key: 'x' }] });
  editor.editSelected(); const draft = editor.getDraft(); const original = editor.exportGeoJSON();
  await userEvent.keyboard('{Home}{ArrowRight>}'); const control = container.querySelector<HTMLButtonElement>('[data-geo-vertex-focus]')!;
  expect(control.title).toContain('C while holding an arrow'); expect(control.getAttribute('aria-keyshortcuts')).toContain('F C X');
  await userEvent.keyboard('c'); expect(editor.getDraft()).toEqual(draft); expect(editor.getState().mode).toBe('edit-polygon');
  await userEvent.keyboard('{/ArrowRight}{ArrowRight} x'); expect(editor.getDraft()).toHaveLength(3);
  await userEvent.keyboard('{Enter}'); expect(editor.getState().mode).toBe('edit-polygon');
  await userEvent.keyboard('f'); expect(editor.getState().mode).toBe('idle'); editor.undo(); expect(editor.exportGeoJSON()).toEqual(original);
});

it('uses remapped cancel to roll back a captured vertex drag without a late release changing it', async () => {
  load(); editor.editSelected(); const draft = editor.getDraft(); editor.setKeyboardShortcuts({ cancel: [{ key: 'c' }] });
  await commands.vertexPointer('down', 150, 120); await commands.vertexPointer('move', 180, 150);
  await expect.poll(() => editor.getDraft()).not.toEqual(draft);
  await userEvent.keyboard('{Escape}'); expect(editor.getDraft()).not.toEqual(draft);
  await userEvent.keyboard('c'); expect(editor.getDraft()).toEqual(draft); expect(editor.getState().mode).toBe('edit-polygon');
  await commands.vertexPointer('up', 180, 150); expect(editor.getDraft()).toEqual(draft); expect(map.dragPan.isEnabled()).toBe(true);
});

it('cancels an active lasso stroke through the new binding and releases pointer capture', async () => {
  load(); editor.setKeyboardShortcuts({ cancel: [{ key: 'c' }] }); editor.lasso();
  await commands.vertexPointer('down', 100, 90); await commands.vertexPointer('move', 450, 90);
  await userEvent.keyboard('c'); expect(editor.getState()).toMatchObject({ mode: 'idle', selectedFeatureIds: ['shape'] });
  await commands.vertexPointer('up', 450, 90); expect(map.dragPan.isEnabled()).toBe(true);
  expect(editor.getState().canUndo).toBe(false);
});

it('cancels a selection rectangle with a custom key while its Shift modifier is still held', async () => {
  load(); editor.setKeyboardShortcuts({ cancel: [{ key: 'c' }] }); const saved = editor.getState().selectedFeatureIds;
  await userEvent.keyboard('{Shift>}'); await commands.vertexPointer('down', 80, 80); await commands.vertexPointer('move', 450, 360);
  expect(container.querySelector('[data-geo-selection-box]')).not.toBeNull();
  await userEvent.keyboard('C'); expect(container.querySelector('[data-geo-selection-box]')).toBeNull();
  await commands.vertexPointer('up', 450, 360); await userEvent.keyboard('{/Shift}');
  expect(editor.getState().selectedFeatureIds).toEqual(saved); expect(map.dragPan.isEnabled()).toBe(true);
});

it.each(['rotate', 'scale', 'buffer'] as const)('remaps finish/cancel on the focused %s control', async tool => {
  load(); editor.setKeyboardShortcuts({ finish: [{ key: 'f', modifiers: ['Control'] }], cancel: [{ key: 'c' }] });
  if (tool === 'rotate') editor.rotateSelection(); else if (tool === 'scale') editor.scaleSelection(); else editor.bufferSelection();
  const selector = tool === 'rotate' ? '[data-geo-rotation-handle]' : tool === 'scale' ? '[data-geo-scale-handle]' : '[data-geo-distance-handle]';
  await expect.poll(() => container.querySelector(selector)).not.toBeNull();
  const handle = container.querySelector<HTMLButtonElement>(selector)!; expect(handle).not.toBeNull(); handle.focus();
  await userEvent.keyboard('{ArrowRight}{Enter}'); expect(editor.getState().mode).not.toBe('idle');
  await userEvent.keyboard('c'); expect(editor.getState().mode).toBe('idle'); expect(editor.getState().canUndo).toBe(false);
  if (tool === 'rotate') editor.rotateSelection(); else if (tool === 'scale') editor.scaleSelection(); else editor.bufferSelection();
  await expect.poll(() => container.querySelector(selector)).not.toBeNull();
  container.querySelector<HTMLButtonElement>(selector)!.focus(); const before = editor.exportGeoJSON();
  await userEvent.keyboard('{ArrowRight}{Control>}f{/Control}'); expect(editor.getState().mode).toBe('idle');
  expect(editor.exportGeoJSON()).not.toEqual(before); editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});

it('disables commands without removing pointer controls and restores a saved binding table', async () => {
  load(); const saved = editor.getKeyboardShortcuts(); editor.setKeyboardShortcuts(false);
  await userEvent.keyboard('{Delete}{Escape}{ArrowRight}{Control>}z{/Control}');
  expect(editor.getState()).toMatchObject({ featureCount: 1, selectedFeatureIds: ['shape'], canUndo: false });
  editor.editSelected(); await userEvent.keyboard('{Home}{Enter}{Escape}'); expect(editor.getState().mode).toBe('edit-polygon');
  editor.cancel(); editor.setKeyboardShortcuts(saved); map.getCanvas().focus(); await userEvent.keyboard('{Delete}');
  expect(editor.getState().featureCount).toBe(0);
});

it('validates constructor bindings before mounting resources and removes listeners on destroy/map removal', () => {
  editor.destroy(); const sources = Object.keys(map.getStyle().sources);
  expect(() => new GeometryEditor(map, { keyboardShortcuts: { point: [{ key: 'Escape' }] } })).toThrow(/conflict/);
  expect(Object.keys(map.getStyle().sources)).toEqual(sources);
  editor = new GeometryEditor(map, { keyboardShortcuts: { point: [{ key: 'p' }] } });
  const draw = vi.spyOn(editor, 'draw'); editor.destroy(); key('p'); expect(draw).not.toHaveBeenCalled();
  const legacy = new LineEditor(map, { keyboardShortcuts: { line: [{ key: 'l' }] } });
  legacy.setKeyboardShortcuts({ cancel: [{ key: 'c' }] }); expect(legacy.getKeyboardShortcutLabel('cancel')).toBe('C');
  key('l'); expect(legacy.getState().mode).toBe('draw-line'); map.remove();
  expect(() => legacy.setKeyboardShortcuts(false)).toThrow(/destroyed/); legacy.destroy();
});
