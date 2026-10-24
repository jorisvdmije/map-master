import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate } from '../src/core/types.js';
const ring: Coordinate[] = [[0, 0], [8, 0], [8, 4], [0, 4], [0, 0]];
function setup() {
  const session = new DrawingSession(() => 'created');
  session.importGeoJSON({ type: 'Feature', id: 0, properties: { nested: { a: [1] } }, geometry: { type: 'Polygon', coordinates: [ring] } });
  session.clearHistory(); return session;
}
it('adds a trace atomically, confirms as one creation and restores exact data through undo/redo', () => {
  const session = setup(); const before = session.exportGeoJSON(); const revision = session.state.dataRevision;
  session.start('LineString');
  expect(session.traceBoundary({ featureId: 0 }, [4, 0], [8, 2])).toBe(true);
  expect(session.getDraft()).toEqual([[4, 0], [8, 0], [8, 2]]);
  expect(session.exportGeoJSON()).toEqual(before); expect(session.state.dataRevision).toBe(revision);
  const result = session.finish()!; expect(result.geometry.coordinates).toEqual([[4, 0], [8, 0], [8, 2]]);
  const after = session.exportGeoJSON(); expect(after.features[0]).toEqual(before.features[0]);
  expect(session.undo()?.action).toBe('create'); expect(session.exportGeoJSON()).toEqual(before);
  session.redo(); expect(session.exportGeoJSON()).toEqual(after);
});
it('mixes free points and traced sections and removes each click as one step', () => {
  const session = setup(); session.start('LineString'); session.add([-1, -1]); session.add([4, 0]);
  session.traceBoundary({ featureId: 0 }, [4, 0], [8, 2]); session.add([9, 3]);
  session.removeLastDrawStep(); expect(session.getDraft()).toEqual([[-1, -1], [4, 0], [8, 0], [8, 2]]);
  session.removeLastDrawStep(); expect(session.getDraft()).toEqual([[-1, -1], [4, 0]]);
  session.removeLastDrawStep(); session.removeLastDrawStep(); expect(session.getDraft()).toEqual([]);
  expect(session.removeLastDrawStep()).toBe(false); expect(session.state.canFinish).toBe(false);
});
it('preserves drafts on disconnected, missing or malformed requests and only operates while drawing', () => {
  const session = setup(); expect(session.traceBoundary({ featureId: 0 }, [0, 0], [8, 2])).toBe(false);
  session.start('Polygon'); session.add([2, 2]); const before = session.getDraft();
  expect(session.traceBoundary({ featureId: 0 }, [0, 0], [8, 2])).toBe(false);
  expect(session.traceBoundary({ featureId: '0' }, [2, 2], [8, 2])).toBe(false);
  expect(() => session.traceBoundary({ featureId: 0 }, [NaN, 0], [8, 2])).toThrow();
  expect(session.getDraft()).toEqual(before); session.cancel(); session.select(0); session.editSelected();
  expect(session.traceBoundary({ featureId: 0 }, [0, 0], [8, 2])).toBe(false);
  expect(session.removeLastDrawStep()).toBe(false);
});
it('closes traced polygons implicitly and keeps invalid combinations visible until corrected', () => {
  const session = setup(); session.start('Polygon'); session.add([4, 0]);
  session.traceBoundary({ featureId: 0 }, [4, 0], [8, 2]);
  session.traceBoundary({ featureId: 0 }, [8, 2], [4, 0], 'longer');
  expect(session.getDraft()).toEqual([[4, 0], [8, 0], [8, 2], [8, 4], [0, 4], [0, 0]]);
  expect(session.state.canFinish).toBe(true); session.removeLastDrawStep();
  session.traceBoundary({ featureId: 0 }, [8, 2], [4, 0]);
  expect(session.state.canFinish).toBe(false); expect(session.finish()).toBeNull();
  session.removeLastDrawStep(); expect(session.state.canFinish).toBe(true);
});
it('cancel preserves redo and drawing-step state is reset for the next tool', () => {
  const session = setup(); session.start('LineString'); session.add([0, 0]); session.add([1, 1]); session.finish(); session.undo();
  const before = session.exportGeoJSON(); session.start('LineString'); session.traceBoundary({ featureId: 0 }, [0, 0], [8, 2]); session.cancel();
  expect(session.state.canRedo).toBe(true); expect(session.exportGeoJSON()).toEqual(before);
  session.start('Polygon'); expect(session.removeLastDrawStep()).toBe(false); session.cancel(); session.redo();
  expect(session.exportGeoJSON().features).toHaveLength(2);
});
it('traces another source to draw a hole with existing hole validation and edit history', () => {
  const session = setup();
  session.importGeoJSON({ type: 'Feature', id: 'inner', properties: null, geometry: { type: 'Polygon', coordinates: [[[2, 1], [4, 1], [4, 3], [2, 3], [2, 1]]] } });
  session.clearHistory(); const before = session.exportGeoJSON(); session.select(0); session.drawHole();
  session.traceBoundary({ featureId: 'inner' }, [2, 1], [4, 3]);
  session.traceBoundary({ featureId: 'inner' }, [4, 3], [2, 1], 'longer');
  expect(session.state.canFinish).toBe(true); expect(session.finish()?.geometry.type).toBe('Polygon');
  expect(session.undo()?.action).toBe('edit'); expect(session.exportGeoJSON()).toEqual(before);
});

it('keeps an already attached draft endpoint through repeated floating-point projection', () => {
  const session = setup();
  const line: Coordinate[] = [[4.89001, 52.37003], [4.89504, 52.37507], [4.89902, 52.37001]];
  session.importGeoJSON({ type: 'Feature', id: 'oblique', properties: null, geometry: { type: 'LineString', coordinates: line } });
  const start: Coordinate = [4.890160899999999, 52.3701812];
  session.start('LineString'); session.add(start);
  expect(session.traceBoundary({ featureId: 'oblique' }, start, line[2]!)).toBe(true);
  expect(session.getDraft()).toEqual([start, line[1], line[2]]);
  session.removeLastDrawStep(); expect(session.getDraft()).toEqual([start]);
});

it('closes back onto an oblique draft attachment despite construction roundoff', () => {
  const session = setup();
  const a: Coordinate = [4.89001, 52.37003]; const b: Coordinate = [4.89504, 52.37507]; const c: Coordinate = [4.89902, 52.37001];
  session.importGeoJSON({ type: 'Feature', id: 'triangle', properties: null, geometry: { type: 'Polygon', coordinates: [[a, b, c, a]] } });
  const start: Coordinate = [4.890160899999999, 52.3701812];
  session.start('Polygon'); session.add(start);
  expect(session.traceBoundary({ featureId: 'triangle' }, start, b)).toBe(true);
  expect(session.traceBoundary({ featureId: 'triangle' }, b, start, 'longer')).toBe(true);
  expect(session.getDraft()).toEqual([start, b, c, a]); expect(session.state.canFinish).toBe(true);
});
