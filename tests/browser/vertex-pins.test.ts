import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, userEvent } from 'vitest/browser';
import { EditorToolbar, GeometryEditor, type Coordinate, type TransactionEvent } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
let container: HTMLDivElement; let map: Map; let editor: GeometryEditor;
const style = (): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] });
const at = (x: number, y: number): Coordinate => map.unproject([x, y]).toArray();
const sourceId = (suffix = '-features') => Object.keys(map.getStyle().sources).find(id => id.endsWith(suffix))!;
const drag = (x: number, y: number, toX: number, toY: number) => userEvent.dragAndDrop(map.getCanvas(), map.getCanvas(), { sourcePosition: { x, y }, targetPosition: { x: toX, y: toY } });
const button = (tool: string) => container.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)!;
const draft = async () => {
  const collection = await map.getSource<GeoJSONSource>(sourceId('-draft'))!.getData();
  if (collection.type !== 'FeatureCollection') throw new Error('Expected preview collection.');
  return collection.features;
};
beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative'; document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 14, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map, { snapping: { enabled: true }, keyboardShortcuts: { pin: [{ key: 'p' }], unpin: [{ key: 'p', modifiers: ['Shift'] }] } });
  editor.importGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 0, properties: null, geometry: { type: 'Polygon', coordinates: [[[100, 100], [350, 100], [350, 350], [100, 350], [100, 100]].map(([x, y]) => at(x!, y!))] } },
    { type: 'Feature', id: '0', properties: { name: 'east' }, geometry: { type: 'Polygon', coordinates: [[[350, 100], [600, 100], [600, 350], [350, 350], [350, 100]].map(([x, y]) => at(x!, y!))] } },
    { type: 'Feature', id: 'marker', properties: { mapMasterText: { text: 'Junction' } }, geometry: { type: 'Point', coordinates: at(350, 100) } },
  ] }); editor.clearHistory(); editor.selectMany([0, '0', 'marker']);
  map.addControl(new EditorToolbar(editor, { tools: ['pin', 'unpin', 'edit', 'delete', 'undo', 'redo'] }));
});
afterEach(async () => {
  await commands.vertexPointer('up', 650, 400); vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove();
});

it('pins from the toolbar and drags a shared corner with all followers, exact one-transaction events and history', async () => {
  const unpinned = editor.exportGeoJSON(); expect(button('pin').disabled).toBe(false); expect(button('pin').getAttribute('aria-pressed')).toBeNull();
  await userEvent.click(button('pin')); expect(editor.getPinnedVertices()).toHaveLength(2);
  const before = editor.exportGeoJSON(); editor.select(0); editor.editSelected();
  const transaction = vi.fn<(event: TransactionEvent) => void>(); const data = vi.fn(); const individual = vi.fn();
  editor.onTransaction(transaction); editor.onDataChange(data); editor.onUpdate(individual);
  await drag(350, 100, 400, 140); expect(editor.getSnap()).toBeNull();
  const preview = editor.getPinnedPreview()!; expect(preview.features).toHaveLength(3); expect(editor.exportGeoJSON()).toEqual(before);
  expect(preview.features[2]?.geometry.coordinates).toEqual(editor.getDraft().find(point => Math.abs(map.project(point).x - 400) < 1));
  await expect.poll(async () => (await draft()).filter(feature => feature.properties?.kind === 'shared-boundary-part')).toHaveLength(1);
  await expect.poll(() => [...container.querySelectorAll('.mm-text-marker[data-preview="true"]')].some(element => element.textContent === 'Junction')).toBe(true);
  for (const id of [0, '0', 'marker']) expect(map.getFeatureState({ source: sourceId(), id: JSON.stringify(id) })).toMatchObject({ editing: true });
  await userEvent.keyboard('{Enter}'); const after = editor.exportGeoJSON(); expect(after).toEqual(preview);
  expect(transaction).toHaveBeenCalledOnce(); expect(transaction.mock.calls[0]?.[0].changes).toHaveLength(3); expect(data).toHaveBeenCalledOnce(); expect(individual).not.toHaveBeenCalled();
  await userEvent.keyboard('{Control>}z{/Control}'); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Control>}y{/Control}'); expect(editor.exportGeoJSON()).toEqual(after);
  editor.undo(); editor.undo(); expect(editor.exportGeoJSON()).toEqual(unpinned);
});

it('supports remapped pin/unpin commands, keyboard nudging and leaves text inputs alone', async () => {
  map.getCanvas().focus(); await userEvent.keyboard('p'); expect(editor.getPinnedVertices()).toHaveLength(2);
  editor.select('marker'); editor.editSelected(); editor.selectVertex(0); const before = editor.exportGeoJSON();
  map.getCanvas().focus(); await userEvent.keyboard('{Home}{ArrowRight}');
  expect(editor.getPinnedPreview()).not.toBeNull(); expect(editor.exportGeoJSON()).toEqual(before);
  await userEvent.keyboard('{Enter}'); expect(editor.exportGeoJSON()).not.toEqual(before);
  map.getCanvas().focus(); await userEvent.keyboard('{Shift>}P{/Shift}'); expect(editor.getPinnedVertices()).toHaveLength(1);
  expect(editor.getPinnedVertices()[0]?.vertices.some(vertex => vertex.featureId === 'marker')).toBe(false);
  editor.undo(); expect(editor.getPinnedVertices()).toHaveLength(2);
  const input = document.createElement('input'); container.append(input); input.focus(); await userEvent.keyboard('p'); expect(editor.getPinnedVertices()).toHaveLength(2);
});

it('blocks invalid or locked followers with accessible feedback and restores them on correction/cancel', () => {
  editor.pinSharedVertices(); editor.clearHistory(); const before = editor.exportGeoJSON(); editor.select('marker'); editor.editSelected();
  editor.moveVertex(0, at(600, 350)); expect(editor.getState()).toMatchObject({ canFinish: false, pinningError: 'pin-invalid-result' });
  expect(container.querySelector<HTMLButtonElement>('[data-primary]')!.disabled).toBe(true);
  const notice = [...container.querySelectorAll('[role="status"]')].find(element => element.textContent?.includes('linked feature')) as HTMLElement;
  expect(notice.hidden).toBe(false); expect(editor.finish()).toBeNull();
  editor.moveVertex(0, at(400, 140)); expect(editor.getState().canFinish).toBe(true); editor.cancel(); expect(editor.exportGeoJSON()).toEqual(before);
  editor.setLockedFeatureIds(['0']); editor.editSelected(); editor.moveVertex(0, at(400, 140)); expect(editor.getState().pinningError).toBe('pin-locked');
  editor.cancel(); expect(button('unpin').disabled).toBe(true); expect(editor.exportGeoJSON()).toEqual(before);
});

it('rolls back captured pointer cancellation and blur, rebuilds followers after style reload and clears them on teardown', async () => {
  editor.pinSharedVertices(); editor.select(0); editor.editSelected(); const before = editor.exportGeoJSON();
  await commands.vertexPointer('down', 350, 100); await commands.vertexPointer('move', 400, 140);
  await expect.poll(() => editor.getPinnedPreview()?.features[1]?.geometry).not.toEqual(before.features[1]?.geometry);
  window.dispatchEvent(new Event('blur')); await commands.vertexPointer('up', 400, 140);
  expect(editor.getPinnedPreview()).toEqual(before); expect(editor.exportGeoJSON()).toEqual(before);
  editor.moveVertex(editor.getDraft().findIndex(point => Math.abs(map.project(point).x - 350) < 1 && Math.abs(map.project(point).y - 100) < 1), at(400, 140));
  const preview = editor.getPinnedPreview();
  const loaded = new Promise<void>(resolve => { map.once('style.load', () => { resolve(); }); }); map.setStyle(style(), { diff: false }); await loaded;
  await expect.poll(async () => (await draft()).filter(feature => feature.properties?.kind === 'shared-boundary-part')).toHaveLength(1);
  expect(editor.getPinnedPreview()).toEqual(preview); editor.destroy();
  expect(Object.keys(map.getStyle().sources)).toEqual([]); expect(map.dragPan.isEnabled()).toBe(true); expect(editor.exportGeoJSON()).toEqual(before);
});

it('moves linked vertices when dragging a whole selected marker, with one commit and one Undo', async () => {
  editor.pinSharedVertices(); editor.clearHistory(); editor.select('marker'); const before = editor.exportGeoJSON();
  const transaction = vi.fn(); editor.onTransaction(transaction);
  await expect.poll(() => map.isSourceLoaded(sourceId())).toBe(true);
  await drag(350, 100, 400, 140); expect(transaction).toHaveBeenCalledOnce();
  const after = editor.exportGeoJSON(); expect(after).not.toEqual(before); expect(editor.getPinnedVertices()[0]?.coordinate).not.toEqual(editor.getPinnedVertices()[1]?.coordinate);
  editor.undo(); expect(editor.exportGeoJSON()).toEqual(before);
});
