import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, GeometryFeatureCollection, LineFeature } from '../src/index.js';

const fixture: GeometryFeatureCollection = { type: 'FeatureCollection', features: [
  { type: 'Feature', id: 'line', properties: { name: 'route' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } },
  { type: 'Feature', id: 'multi', properties: null, geometry: { type: 'MultiPolygon', coordinates: [
    [[[2, 1], [3, 1], [3, 2], [2, 2], [2, 1]]], [[[4, 1], [5, 1], [5, 2], [4, 2], [4, 1]]],
  ] } },
] };
function setup(kind: 'rotation' | 'scale') {
  const session = new DrawingSession(() => 'unused'); session.importGeoJSON(fixture); session.clearHistory(); session.selectMany(['line', 'multi']);
  return {
    session,
    begin: (pivot?: Coordinate) => kind === 'rotation' ? session.rotateSelection(pivot) : session.scaleSelection(pivot),
    set: (pivot?: Coordinate) => kind === 'rotation' ? session.setRotationPivot(pivot) : session.setScalePivot(pivot),
    transform: () => kind === 'rotation' ? session.setRotationAngle(90) : session.setScaleFactors(2, 0.5),
    pivot: () => kind === 'rotation' ? session.state.rotationPivot : session.state.scalePivot,
    preview: () => kind === 'rotation' ? session.getRotationPreview() : session.getScalePreview(),
    finish: () => kind === 'rotation' ? session.finishRotation() : session.finishScale(),
  };
}
it.each(['rotation', 'scale'] as const)('recomputes %s from originals around an isolated pivot and commits once', kind => {
  const tool = setup(kind); const reference = setup(kind); const before = tool.session.exportGeoJSON();
  tool.begin(); tool.transform(); const center = tool.pivot(); const centered = tool.preview();
  const pivot: Coordinate = [1, 0]; expect(tool.set(pivot)).toBe(true); pivot[0] = 99;
  expect(tool.pivot()).toEqual([1, 0]); tool.pivot()![1] = 99; expect(tool.pivot()).toEqual([1, 0]);
  const line = tool.preview()!.features[0] as LineFeature; expect(line.geometry.coordinates[1]).toEqual([1, 0]);
  if (kind === 'rotation') { expect(line.geometry.coordinates[0]![0]).toBeCloseTo(1); expect(line.geometry.coordinates[0]![1]).toBeCloseTo(0.9999492343); }
  else expect(line.geometry.coordinates[0]).toEqual([-1, 0]);
  expect(tool.set([1, 0])).toBe(false);
  reference.begin([1, 0]); reference.transform(); expect(tool.preview()).toEqual(reference.preview());
  tool.set(); expect(tool.pivot()).toEqual(center); expect(tool.preview()).toEqual(centered); expect(tool.set()).toBe(false);
  tool.set([1, 0]); const after = tool.preview()!;
  expect(tool.session.exportGeoJSON()).toEqual(before); expect(tool.session.state.canUndo).toBe(false);
  expect(tool.finish()!.changes).toHaveLength(2); expect(tool.session.exportGeoJSON()).toEqual(after);
  tool.session.undo(); expect(tool.session.exportGeoJSON()).toEqual(before); expect(tool.session.state.canUndo).toBe(false);
  tool.session.redo(); expect(tool.session.exportGeoJSON()).toEqual(after);
});
it.each(['rotation', 'scale'] as const)('rejects malformed %s pivots atomically, including while inactive', kind => {
  const tool = setup(kind);
  expect(tool.set([0, 0])).toBe(false); expect(tool.set()).toBe(false);
  for (const active of [false, true]) {
    if (active) { tool.begin(); tool.transform(); }
    const state = tool.session.state; const preview = tool.preview();
    for (const bad of [null, [1], [1, 2, 3], [NaN, 0], ['1', 0], [Infinity, 0]]) expect(() => tool.set(bad as Coordinate)).toThrow(TypeError);
    for (const bad of [[181, 0], [0, 86], [-181, 0]]) expect(() => tool.set(bad as Coordinate)).toThrow(RangeError);
    expect(tool.session.state).toEqual(state); expect(tool.preview()).toEqual(preview);
  }
});
it.each(['rotation', 'scale'] as const)('keeps invalid %s pivot results in review and recovers by resetting', kind => {
  const tool = setup(kind); tool.begin(); tool.transform(); const before = tool.preview();
  tool.set(kind === 'rotation' ? [179, 80] : [-179, 0]);
  expect(tool.session.state.canFinish).toBe(false); expect(tool.preview()).toBeNull(); expect(tool.finish()).toBeNull();
  expect(tool.session.exportGeoJSON()).toEqual(fixture);
  tool.set(); expect(tool.session.state.canFinish).toBe(true); expect(tool.preview()).toEqual(before);
  tool.session.cancel(); expect(tool.session.state.canUndo).toBe(false);
});
it.each(['rotation', 'scale'] as const)('does not record %s pivot-only changes and preserves Redo', kind => {
  const tool = setup(kind); tool.begin(); tool.transform(); tool.finish(); tool.session.undo();
  const revision = tool.session.state.dataRevision;
  tool.begin(); tool.set([1, 0]); expect(tool.preview()).toEqual(fixture); expect(tool.finish()).toBeNull();
  expect(tool.session.state).toMatchObject({ dataRevision: revision, canUndo: false, canRedo: true, mode: 'idle' });
});
