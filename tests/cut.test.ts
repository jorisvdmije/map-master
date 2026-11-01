import { describe, expect, it } from 'vitest';
import { cutGeometry } from '../src/core/cut.js';
import { DrawingSession } from '../src/core/drawing-session.js';
import { FeatureLockedError } from '../src/core/feature-locks.js';
import type { Coordinate, GeometryFeatureCollection } from '../src/index.js';

const cutter: Coordinate[] = [[1, -1], [2, -1], [2, 3], [1, 3]];

describe('cutGeometry', () => {
  it('removes the cut area from polygons and deletes fully covered ones', () => {
    const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [3, 0], [3, 2], [0, 2], [0, 0]]] as Coordinate[][] };
    const result = cutGeometry(square, cutter);
    expect(result.error).toBeNull();
    expect(result.geometry?.type).toBe('MultiPolygon');
    expect(cutGeometry({ type: 'Polygon', coordinates: [[[1.2, 0], [1.8, 0], [1.8, 1], [1.2, 0]]] }, cutter).geometry).toBeNull();
    const far = { type: 'Polygon' as const, coordinates: [[[10, 10], [11, 10], [11, 11], [10, 10]]] as Coordinate[][] };
    expect(cutGeometry(far, cutter).geometry).toBe(far);
  });

  it('keeps the parts of lines outside the cut', () => {
    const line = { type: 'LineString' as const, coordinates: [[0, 1], [3, 1]] as Coordinate[] };
    expect(cutGeometry(line, cutter)).toEqual({ error: null, geometry: { type: 'MultiLineString', coordinates: [[[0, 1], [1, 1]], [[2, 1], [3, 1]]] } });
    expect(cutGeometry({ type: 'LineString', coordinates: [[0, 1], [1.5, 1]] }, cutter).geometry).toEqual({ type: 'LineString', coordinates: [[0, 1], [1, 1]] });
    expect(cutGeometry({ type: 'LineString', coordinates: [[1.2, 0], [1.8, 2]] }, cutter).geometry).toBeNull();
    // Lines along the cut boundary stay; bends are preserved outside.
    const boundary = { type: 'LineString' as const, coordinates: [[1, -2], [1, 4]] as Coordinate[] };
    expect(cutGeometry(boundary, cutter).geometry).toEqual(boundary);
    expect(cutGeometry({ type: 'LineString', coordinates: [[0, 0], [0.5, 1.5], [1.5, 1.5]] }, cutter).geometry)
      .toEqual({ type: 'LineString', coordinates: [[0, 0], [0.5, 1.5], [1, 1.5]] });
    const multi = cutGeometry({ type: 'MultiLineString', coordinates: [[[0, 1], [0.5, 1]], [[1.5, 0], [1.5, 2]]] }, cutter);
    expect(multi.geometry).toEqual({ type: 'MultiLineString', coordinates: [[[0, 1], [0.5, 1]]] });
  });

  it('leaves markers unchanged', () => {
    const point = { type: 'Point' as const, coordinates: [1.5, 1] as Coordinate };
    expect(cutGeometry(point, cutter).geometry).toBe(point);
  });
});

describe('cutting in a session', () => {
  const data = (): GeometryFeatureCollection => ({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'field', properties: { crop: 'wheat' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 2], [0, 2], [0, 0]]] } },
    { type: 'Feature', id: 'road', properties: null, geometry: { type: 'LineString', coordinates: [[0, 1], [3, 1]] } },
    { type: 'Feature', id: 'shed', properties: null, geometry: { type: 'Polygon', coordinates: [[[1.2, 0.2], [1.8, 0.2], [1.8, 0.8], [1.2, 0.2]]] } },
    { type: 'Feature', id: 'well', properties: null, geometry: { type: 'Point', coordinates: [1.5, 1.5] } },
    { type: 'Feature', id: 'far', properties: null, geometry: { type: 'Polygon', coordinates: [[[10, 10], [11, 10], [11, 11], [10, 10]]] } },
  ] });
  const setup = (locked: string[] = []): DrawingSession => {
    const session = new DrawingSession(() => 'new', 100, locked);
    session.importGeoJSON(data()); session.clearHistory(); return session;
  };
  const drawCutter = (session: DrawingSession): void => { for (const point of cutter) session.add(point); };

  it('cuts every unlocked feature as one undoable transaction', () => {
    const session = setup(['road']);
    expect(session.drawCut()).toBe(true);
    expect(session.state.mode).toBe('draw-cut');
    expect(session.drawCut()).toBe(false);
    expect(session.finishCut()).toBeNull();
    drawCutter(session);
    expect(session.state.canFinish).toBe(true);
    expect(session.finish()).toBeNull();
    const event = session.finishCut()!;
    expect(event.changes.map(({ before, after }) => [before?.id, after?.id ?? null])).toEqual([['field', 'field'], ['shed', null]]);
    expect(session.getFeature('field')).toMatchObject({ properties: { crop: 'wheat' }, geometry: { type: 'MultiPolygon' } });
    expect(session.getFeature('road')?.geometry).toEqual(data().features[1]!.geometry);
    expect(session.getFeature('well')).not.toBeNull();
    expect(session.state).toMatchObject({ mode: 'idle', canUndo: true });
    session.undo();
    expect(session.exportGeoJSON()).toEqual(data());
  });

  it('limits the cut to the selection and ends without changes when nothing overlaps', () => {
    const session = setup();
    session.select('road');
    session.drawCut();
    expect(session.state.selectedFeatureIds).toEqual(['road']);
    drawCutter(session);
    const event = session.finishCut()!;
    expect(event.changes).toHaveLength(1);
    expect(session.getFeature('road')?.geometry.type).toBe('MultiLineString');
    session.select('far');
    session.drawCut(); drawCutter(session);
    expect(session.finishCut()).toBeNull();
    expect(session.state).toMatchObject({ mode: 'idle', dataRevision: 2 });
  });

  it('refuses to start with a locked selection', () => {
    const session = setup(['field']);
    session.select('field');
    expect(session.drawCut()).toBe(false);
    session.select(null);
    session.drawCut();
    expect(() => session.drawCut()).not.toThrow();
    session.cancel();
    expect(() => { session.importGeoJSON({ type: 'Feature', id: 'field', properties: null, geometry: { type: 'Point', coordinates: [0, 0] } }); }).toThrow();
    expect(FeatureLockedError).toBeDefined();
  });
});
