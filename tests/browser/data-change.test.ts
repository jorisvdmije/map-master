import { Map, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  GeometryEditor, type DataChangeEvent, type FeatureId, type GeometryFeature, type LineFeature, type PolygonFeature,
} from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
let container: HTMLDivElement;
let map: Map;
let editor: GeometryEditor;
const click = (x: number, y: number) => userEvent.click(map.getCanvas(), { position: { x, y } });
const at = (x: number, y: number) => map.unproject([x, y]).toArray();
const line = (id: FeatureId, y: number): LineFeature => ({ type: 'Feature', id, properties: { name: `line ${id}` },
  geometry: { type: 'LineString', coordinates: [at(100, y), at(500, y)] },
});
const square = (id: FeatureId, x: number, y: number, size = 100): PolygonFeature => ({ type: 'Feature', id, properties: { name: `area ${id}` },
  geometry: { type: 'Polygon', coordinates: [[at(x, y + size), at(x + size, y + size), at(x + size, y), at(x, y), at(x, y + size)]] },
});
const record = () => {
  const events: DataChangeEvent[] = [];
  editor.onDataChange((event) => { events.push(event); });
  return events;
};

beforeEach(async () => {
  container = document.createElement('div'); container.style.cssText = 'width:700px;height:450px;position:relative;';
  document.body.append(container);
  map = new Map({ container, center: [4.895, 52.372], zoom: 13, fadeDuration: 0,
    style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] } });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new GeometryEditor(map);
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); map.remove(); container.remove(); });

it('reports drawing, vertex edits and deletion with before/after snapshots and the new revision', async () => {
  const events = record();
  editor.draw('LineString'); await click(100, 100); await click(500, 100);
  expect(events).toEqual([]);
  const created = editor.finish()!;
  expect(events).toEqual([{ source: 'create', changes: [{ before: null, after: created }], dataRevision: 1 }]);

  editor.select(created.id); editor.editSelected();
  editor.moveVertex(1, at(500, 200));
  expect(events).toHaveLength(1);
  const updated = editor.finish()!;
  expect(events[1]).toEqual({ source: 'update', changes: [{ before: created, after: updated }], dataRevision: 2 });

  editor.select(created.id); editor.editSelected();
  expect(editor.finish()).toEqual(updated);
  expect(events).toHaveLength(2);

  editor.select(created.id);
  expect(editor.deleteSelected()).toEqual(updated);
  expect(events[2]).toEqual({ source: 'delete', changes: [{ before: updated, after: null }], dataRevision: 3 });
});

it('reports imports, transactions, geometry tools and undo/redo, so a host can mirror the store', () => {
  const mirror = new globalThis.Map<FeatureId, GeometryFeature>();
  const events = record();
  editor.onDataChange(({ changes }) => {
    for (const { before, after } of changes) {
      if (after) mirror.set(after.id, after); else mirror.delete(before!.id);
    }
  });
  const sources = () => events.map((event) => event.source);
  const mirrored = () => [...mirror.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const stored = () => editor.exportGeoJSON().features.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  editor.importGeoJSON({ type: 'FeatureCollection', features: [line('a', 100), square('b', 100, 200), square('c', 150, 250)] });
  expect(events[0]).toMatchObject({ source: 'import', dataRevision: 1 });
  expect(events[0]!.changes.map(({ before, after }) => [before, after?.id])).toEqual([[null, 'a'], [null, 'b'], [null, 'c']]);

  editor.applyTransaction({ update: [{ ...line('a', 120), properties: { name: 'renamed' } }] });
  editor.selectMany(['b', 'c']);
  expect(editor.unionSelection()).toBe(true);
  expect(sources()).toEqual(['import', 'transaction']);
  editor.finishUnion();
  expect(sources()).toEqual(['import', 'transaction', 'transaction']);
  expect(events[2]!.changes.map(({ before, after }) => [before?.id ?? null, after?.id ?? null])).toEqual([['b', 'b'], ['c', null]]);
  expect(mirrored()).toEqual(stored());

  editor.undo(); expect(mirrored()).toEqual(stored());
  editor.undo(); expect(mirrored()).toEqual(stored());
  editor.redo(); expect(mirrored()).toEqual(stored());
  expect(sources().slice(3)).toEqual(['undo', 'undo', 'redo']);
  expect(events.map((event) => event.dataRevision)).toEqual([1, 2, 3, 4, 5, 6]);
});

it('ignores drafts, previews, cancellation and unchanged batches', async () => {
  editor.importGeoJSON(square('b', 100, 100)); editor.importGeoJSON(square('c', 150, 150));
  const events = record();
  editor.draw('Polygon'); await click(400, 100); await click(500, 100); await click(500, 200); editor.cancel();
  editor.select('b'); editor.editSelected(); editor.moveVertex(0, at(90, 210)); editor.cancel();
  editor.selectMany(['b', 'c']); editor.intersectionSelection(); editor.cancel();
  editor.rotateSelection(); editor.setRotationAngle(30); editor.cancel();
  expect(editor.applyTransaction({})).toBeNull();
  expect(editor.applyTransaction({ update: [editor.getFeature('b')!] })).toBeNull();
  expect(() => editor.applyTransaction({ delete: ['missing'] })).toThrow(RangeError);
  expect(events).toEqual([]);
});

it('delivers independent snapshots after the specific event and before onChange', () => {
  const order: string[] = [];
  editor.onImport(() => { order.push('import'); });
  editor.onDataChange((event) => {
    order.push('data');
    expect(editor.getState().dataRevision).toBe(event.dataRevision);
    event.changes[0]!.after!.properties = { mutated: true };
    event.changes.length = 0;
  });
  const second = vi.fn<(event: DataChangeEvent) => void>(); editor.onDataChange(second);
  editor.onChange(() => { order.push('change'); });
  editor.onDataChange(vi.fn())();

  editor.importGeoJSON(line('a', 100));
  expect(order).toEqual(['import', 'data', 'change']);
  expect(second.mock.calls[0]![0].changes[0]!.after!.properties).toEqual({ name: 'line a' });
  expect(editor.getFeature('a')!.properties).toEqual({ name: 'line a' });
});

it('returns independent feature copies by ID', () => {
  editor.importGeoJSON({ type: 'Feature', id: 7, properties: { nested: { value: 1 } }, geometry: line(7, 100).geometry });
  const feature = editor.getFeature(7)!;
  expect(feature).toEqual(editor.exportGeoJSON().features[0]);
  (feature.properties!.nested as { value: number }).value = 2;
  feature.geometry.coordinates.length = 0;
  expect(editor.getFeature(7)!.properties).toEqual({ nested: { value: 1 } });
  expect(editor.getFeature('7')).toBeNull();
  expect(editor.getFeature('missing')).toBeNull();
  editor.destroy();
  expect(() => editor.onDataChange(vi.fn())).toThrow('destroyed');
});
