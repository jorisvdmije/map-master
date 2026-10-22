import { describe, expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, GeometryType } from '../src/core/types.js';

function fixture(kind: GeometryType): DrawingSession {
  let id = 0;
  const session = new DrawingSession(() => `feature-${++id}`);
  session.start(kind);
  const points: Coordinate[] = kind === 'Polygon' ? [[0, 0], [4, 0], [4, 4], [0, 4]] : [[0, 0], [2, 2], [4, 0]];
  points.forEach((point) => session.add(point));
  session.finish(); session.select('feature-1');
  return session;
}

describe('vertex edit transactions', () => {
  it.each<GeometryType>(['LineString', 'Polygon'])('keeps a %s edit separate until saving with its original ID', (kind) => {
    const session = fixture(kind);
    const original = session.exportGeoJSON();
    expect(session.editSelected()).toBe(true);
    expect(session.editSelected()).toBe(false);
    session.moveVertex(0, [-1, 0]);
    expect(session.exportGeoJSON()).toEqual(original);
    expect(session.getSelected()).toEqual(original.features[0]);
    expect(session.state).toMatchObject({ selectedFeatureId: 'feature-1', selectedVertexIndex: 0, dataRevision: 1 });
    const updated = session.finish();
    expect(updated?.id).toBe('feature-1');
    expect(updated?.properties).toEqual(original.features[0]?.properties);
    expect(session.state).toMatchObject({ mode: 'idle', selectedFeatureId: 'feature-1', selectedVertexIndex: null, dataRevision: 2, featureCount: 1 });
    expect(session.finish()).toBeNull();
    if (updated?.geometry.type === 'Polygon') {
      expect(updated.geometry.coordinates[0]?.[0]).toEqual([-1, 0]);
      expect(updated.geometry.coordinates[0]?.at(-1)).toEqual([-1, 0]);
      expect(updated.geometry.coordinates[0]).toHaveLength(5);
    }
    session.start('LineString'); session.add([8, 8]); session.add([9, 9]);
    expect(session.finish()?.id).toBe('feature-2');
  });

  it('restores exact data and selection on cancel after move, insert, and remove', () => {
    const session = fixture('Polygon'); const original = session.exportGeoJSON();
    session.editSelected(); session.moveVertex(0, [-1, 0]);
    session.insertVertex(2, [5, 2]); session.removeVertex(3);
    expect(session.cancel()).toBe(true);
    expect(session.cancel()).toBe(false);
    expect(session.exportGeoJSON()).toEqual(original);
    expect(session.state).toMatchObject({ mode: 'idle', selectedFeatureId: 'feature-1', selectedVertexIndex: null, dataRevision: 1 });
    expect(session.getDraft()).toEqual([]);
  });

  it('does not increment the data revision for unchanged saves or moves reverted before save', () => {
    const session = fixture('Polygon'); const original = session.exportGeoJSON();
    session.editSelected(); session.finish();
    expect(session.state.dataRevision).toBe(1);
    session.editSelected(); session.moveVertex(0, [-1, 0]); session.moveVertex(0, [0, 0]);
    session.finish();
    expect(session.state.dataRevision).toBe(1);
    expect(session.exportGeoJSON()).toEqual(original);
  });

  it('rejects a crossing polygon at commit, then allows correcting the draft', () => {
    const session = fixture('Polygon'); const original = session.exportGeoJSON();
    session.editSelected(); session.moveVertex(1, [2, 5]);
    expect(session.state.validationError).toBe('self-intersection');
    expect(session.finish()).toBeNull();
    expect(session.state.mode).toBe('edit-polygon');
    expect(session.exportGeoJSON()).toEqual(original);
    session.moveVertex(1, [5, 0]);
    expect(session.state.canFinish).toBe(true);
    expect(session.finish()?.id).toBe('feature-1');
  });

  it('never mistakes coinciding first and last edit vertices for a closing copy', () => {
    const session = fixture('Polygon'); session.editSelected();
    session.moveVertex(3, [0, 0]);
    expect(session.state.validationError).toBe('duplicate-vertex');
    expect(session.finish()).toBeNull();
    expect(session.getDraft()).toHaveLength(4);
  });

  it('rejects consecutive duplicate line points and dateline-spanning polygon edits', () => {
    const line = fixture('LineString'); line.editSelected(); line.moveVertex(1, [0, 0]);
    expect(line.state.validationError).toBe('duplicate-vertex');
    expect(line.finish()).toBeNull();
    const polygon = fixture('Polygon'); polygon.editSelected(); polygon.moveVertex(0, [-179, 0]);
    expect(polygon.state.validationError).toBe('antimeridian-crossing');
    expect(polygon.finish()).toBeNull();
  });

  it.each<GeometryType>(['LineString', 'Polygon'])('inserts into %s, permits removing a corner, and preserves minimum cardinality', (kind) => {
    const session = fixture(kind); session.editSelected();
    const minimum = kind === 'Polygon' ? 3 : 2;
    const before = session.state.vertexCount;
    session.insertVertex(before, kind === 'Polygon' ? [-1, 2] : [5, 0]);
    expect(session.state.selectedVertexIndex).toBe(before);
    expect(session.getDraft()).toHaveLength(before + 1);
    expect(session.removeVertex(before)).toBe(true);
    expect(session.state.selectedVertexIndex).toBeNull();
    session.removeVertex(1); session.selectVertex(0);
    expect(session.state.vertexCount).toBe(minimum);
    expect(session.removeVertex(0)).toBe(false);
    expect(session.state.selectedVertexIndex).toBe(0);
    expect(session.finish()).not.toBeNull();
  });

  it('validates coordinates and indexes before changing the draft or selected vertex', () => {
    const session = fixture('LineString'); session.editSelected(); session.selectVertex(1);
    const draft = session.getDraft(); const state = session.state;
    for (const index of [-1, 0.5, NaN, 3]) {
      expect(() => session.moveVertex(index, [1, 1])).toThrow(RangeError);
      expect(() => session.removeVertex(index)).toThrow(RangeError);
      expect(() => session.selectVertex(index)).toThrow(RangeError);
    }
    expect(() => session.insertVertex(4, [1, 1])).toThrow(RangeError);
    for (const point of [[NaN, 0], [181, 0], [0, 91]] as Coordinate[]) {
      expect(() => session.moveVertex(0, point)).toThrow(RangeError);
      expect(() => session.insertVertex(0, point)).toThrow(RangeError);
    }
    expect(session.getDraft()).toEqual(draft); expect(session.state).toEqual(state);
  });

  it('protects active interactions and rejects vertex commands outside editing', () => {
    const session = fixture('LineString'); session.select(null);
    expect(session.editSelected()).toBe(false);
    expect(() => session.moveVertex(0, [1, 1])).toThrow('Start editing');
    expect(() => session.insertVertex(0, [1, 1])).toThrow('Start editing');
    expect(() => session.removeVertex(0)).toThrow('Start editing');
    session.start('Polygon'); session.add([1, 1]);
    expect(() => session.editSelected()).toThrow('Finish or cancel');
    session.cancel(); session.select('feature-1'); session.editSelected();
    expect(() => session.start('LineString')).toThrow('Finish or cancel');
    expect(() => session.select(null)).toThrow('Finish or cancel');
    expect(() => session.deleteSelected()).toThrow('Finish or cancel');
  });

  it('isolates caller-owned coordinates, draft snapshots, and returned saved features', () => {
    const session = fixture('LineString'); session.editSelected();
    const point: Coordinate = [-1, 0]; session.moveVertex(0, point); point[0] = 99;
    session.getDraft()[0]![0] = 99;
    const result = session.finish(); result!.geometry.coordinates.length = 0;
    expect(session.exportGeoJSON().features[0]?.geometry.coordinates).toEqual([[-1, 0], [2, 2], [4, 0]]);
  });
});
