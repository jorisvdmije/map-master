import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, GeometryFeatureCollection } from '../src/index.js';

const square = (x: number, y: number, size = 1): Coordinate[] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
const data = (): GeometryFeatureCollection => ({ type: 'FeatureCollection', features: [
  { type: 'Feature', id: 'a', properties: { name: 'A' }, geometry: { type: 'Polygon', coordinates: [square(0, 0)] } },
  { type: 'Feature', id: 'b', properties: { name: 'B' }, geometry: { type: 'Polygon', coordinates: [square(2, 0)] } },
  { type: 'Feature', id: 'overlap', properties: null, geometry: { type: 'Polygon', coordinates: [square(0.5, 0.5)] } },
  { type: 'Feature', id: 'route', properties: null, geometry: { type: 'LineString', coordinates: [[0, 5], [1, 5]] } },
  { type: 'Feature', id: 'track', properties: null, geometry: { type: 'MultiLineString', coordinates: [[[0, 6], [1, 6]], [[2, 6], [3, 6]]] } },
  { type: 'Feature', id: 'marker', properties: null, geometry: { type: 'Point', coordinates: [9, 9] } },
] });
function setup(locked: string[] = []): DrawingSession {
  let id = 0;
  const session = new DrawingSession(() => `new-${++id}`, 100, locked);
  session.importGeoJSON(data()); session.clearHistory(); return session;
}

it('combines polygons or lines into one multipart feature and separates them again', () => {
  const session = setup();
  session.selectMany(['a', 'b']);
  const combined = session.combineSelection()!;
  expect(combined.changes).toHaveLength(2);
  expect(session.getFeature('a')).toEqual({ type: 'Feature', id: 'a', properties: { name: 'A' },
    geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0)], [square(2, 0)]] } });
  expect(session.getFeature('b')).toBeNull();
  expect(session.state.selectedFeatureIds).toEqual(['a']);

  const exploded = session.explodeSelection()!;
  expect(exploded.changes.map(({ after }) => after?.id)).toEqual(['a', 'new-1']);
  expect(session.getFeature('a')?.geometry).toEqual({ type: 'Polygon', coordinates: [square(0, 0)] });
  expect(session.getFeature('new-1')).toMatchObject({ properties: { name: 'A' }, geometry: { type: 'Polygon', coordinates: [square(2, 0)] } });
  expect(session.state.selectedFeatureIds).toEqual(['a', 'new-1']);
  session.undo(); session.undo();
  expect(session.exportGeoJSON()).toEqual(data());

  session.selectMany(['route', 'track']);
  session.combineSelection();
  expect(session.getFeature('route')?.geometry).toEqual({ type: 'MultiLineString', coordinates: [[[0, 5], [1, 5]], [[0, 6], [1, 6]], [[2, 6], [3, 6]]] });
});

it('refuses mixed, overlapping, single, simple and locked selections', () => {
  const session = setup(['b']);
  session.selectMany(['a', 'route']); expect(session.combineSelection()).toBeNull();
  session.selectMany(['a', 'overlap']); expect(session.combineSelection()).toBeNull();
  session.selectMany(['a']); expect(session.combineSelection()).toBeNull();
  session.selectMany(['a', 'b']); expect(session.combineSelection()).toBeNull();
  session.selectMany(['a', 'marker']); expect(session.explodeSelection()).toBeNull();
  session.selectMany(['track', 'b']); expect(session.explodeSelection()).toBeNull();
  expect(session.state.dataRevision).toBe(1);
  session.selectMany(['track']); session.start('Polygon');
  expect(() => session.combineSelection()).toThrow('Finish or cancel');
  expect(() => session.explodeSelection()).toThrow('Finish or cancel');
});

it('draws a new polygon part that may not overlap existing parts', () => {
  const session = setup();
  session.select('a');
  expect(session.drawPart()).toBe(true);
  expect(session.state).toMatchObject({ mode: 'draw-part', activePartIndex: 1, activeRingIndex: 0 });
  expect(session.drawPart()).toBe(false);
  expect(session.getInactiveParts()).toEqual([{ type: 'Polygon', coordinates: [square(0, 0)] }]);
  for (const point of square(0.5, 0.5).slice(0, 4)) session.add(point);
  expect(session.state).toMatchObject({ canFinish: false, validationError: 'part-intersection' });
  session.cancel();
  session.drawPart();
  for (const point of square(5, 5).slice(0, 4)) session.add(point);
  expect(session.state.canFinish).toBe(true);
  const feature = session.finish()!;
  expect(feature).toMatchObject({ id: 'a', properties: { name: 'A' }, geometry: { type: 'MultiPolygon' } });
  expect(feature.geometry.coordinates).toHaveLength(2);
  expect(session.state.mode).toBe('idle');
  session.undo();
  expect(session.getFeature('a')?.geometry.type).toBe('Polygon');
});

it('draws a new line part and refuses markers and locked features', () => {
  const session = setup(['b']);
  session.select('route');
  session.drawPart();
  expect(session.state).toMatchObject({ mode: 'draw-part', activeRingIndex: null });
  session.add([5, 5]);
  expect(session.state.canFinish).toBe(false);
  session.add([6, 5]);
  expect(session.finish()?.geometry).toEqual({ type: 'MultiLineString', coordinates: [[[0, 5], [1, 5]], [[5, 5], [6, 5]]] });
  session.select('marker'); expect(session.drawPart()).toBe(false);
  session.select('b'); expect(session.drawPart()).toBe(false);
  session.select(null); expect(session.drawPart()).toBe(false);
});
