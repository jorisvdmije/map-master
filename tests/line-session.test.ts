import { describe, expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate } from '../src/core/types.js';

function session(): DrawingSession {
  let id = 0;
  return new DrawingSession(() => `feature-${++id}`);
}

describe('line drawing state', () => {
  it('keeps inactive and unfinished geometry out of exports', () => {
    const tool = session();
    expect(tool.add([4, 52])).toBe(false);
    expect(tool.finish()).toBeNull();
    tool.start('LineString');
    tool.add([4, 52]);
    expect(tool.finish()).toBeNull();
    expect(tool.exportGeoJSON()).toEqual({ type: 'FeatureCollection', features: [] });
    expect(tool.state).toMatchObject({ mode: 'draw-line', vertexCount: 1, canFinish: false });
  });

  it('ignores consecutive duplicate points and preserves an already active draft', () => {
    const tool = session();
    tool.start('LineString');
    tool.add([4, 52]);
    expect(tool.add([4, 52])).toBe(false);
    expect(tool.start('LineString')).toBe(false);
    expect(tool.state.vertexCount).toBe(1);
    expect(tool.finish()).toBeNull();
  });

  it.each<Coordinate>([
    [NaN, 52], [4, Infinity], [181, 52], [-181, 52], [4, 91], [4, -91],
  ])('rejects invalid position [%s, %s] without changing the draft', (lng, lat) => {
    const tool = session();
    tool.start('LineString');
    tool.add([4, 52]);
    expect(() => tool.add([lng, lat])).toThrow(RangeError);
    expect(tool.getDraft()).toEqual([[4, 52]]);
  });

  it('commits once with stable unique IDs and longitude/latitude order', () => {
    const tool = session();
    tool.start('LineString');
    tool.add([4, 52]);
    tool.add([5, 53]);
    expect(tool.finish()).toEqual({
      type: 'Feature', id: 'feature-1', properties: {},
      geometry: { type: 'LineString', coordinates: [[4, 52], [5, 53]] },
    });
    expect(tool.finish()).toBeNull();
    expect(tool.state).toEqual({ mode: 'idle', vertexCount: 0, canFinish: false, featureCount: 1, validationError: null, splitError: null, sharedBoundaryError: null, rotationAngle: null, rotationPivot: null, rotationError: null, reshapeError: null, reshapeSide: null, unionError: null, differenceError: null, intersectionError: null, selectedFeatureIds: [], selectedFeatureId: null, selectedVertexIndex: null, activeRingIndex: null, activePartIndex: null, dataRevision: 1, canUndo: true, canRedo: false });
    tool.start('LineString');
    tool.add([6, 54]);
    tool.add([7, 55]);
    expect(tool.finish()?.id).toBe('feature-2');
    expect(tool.exportGeoJSON().features.map((feature) => feature.id)).toEqual(['feature-1', 'feature-2']);
  });

  it('isolates state from input, draft, return-value, and export mutations', () => {
    const tool = session();
    const point: Coordinate = [4, 52];
    tool.start('LineString');
    tool.add(point);
    point[0] = 90;
    tool.getDraft()[0]?.splice(0, 2, 90, 90);
    tool.add([5, 53]);
    const feature = tool.finish();
    feature?.geometry.coordinates.splice(0);
    const output = tool.exportGeoJSON();
    const first = output.features[0];
    if (first) { first.id = 'changed'; first.geometry.coordinates[0]?.splice(0); }
    expect(tool.exportGeoJSON().features[0]).toMatchObject({
      id: 'feature-1', geometry: { coordinates: [[4, 52], [5, 53]] },
    });
  });

  it('cancels only the draft, and can start another line afterwards', () => {
    const tool = session();
    tool.start('LineString'); tool.add([4, 52]); tool.add([5, 53]); tool.finish();
    const saved = tool.exportGeoJSON();
    tool.start('LineString'); tool.add([6, 54]);
    expect(tool.cancel()).toBe(true);
    expect(tool.cancel()).toBe(false);
    expect(tool.exportGeoJSON()).toEqual(saved);
    tool.start('LineString'); tool.add([7, 55]); tool.add([8, 56]);
    expect(tool.finish()?.geometry.coordinates).toEqual([[7, 55], [8, 56]]);
  });
});
