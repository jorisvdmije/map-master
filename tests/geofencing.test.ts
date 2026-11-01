import { expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { GeofencingError, GeofencingPolicy, type GeofenceArea } from '../src/core/geofencing.js';
import type { Coordinate, GeometryFeature, GeometryFeatureCollection, PolygonFeature } from '../src/core/types.js';

const rectangle = (x: number, y: number, w: number, h = w): PolygonFeature['geometry'] => ({ type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] });
const area = (id = 'park', geometry: GeofenceArea['geometry'] = rectangle(0, 0, 10)): GeofenceArea => ({ id, geometry });
const point = (id: string | number, coordinate: Coordinate): GeometryFeature => ({ type: 'Feature', id, properties: { keep: { value: [1, null] } }, geometry: { type: 'Point', coordinates: coordinate } });
const polygon = (id: string | number, geometry = rectangle(1, 1, 2)): GeometryFeature => ({ type: 'Feature', id, properties: null, geometry });
const line = (id: string | number, coordinates: Coordinate[]): GeometryFeature => ({ type: 'Feature', id, properties: {}, geometry: { type: 'LineString', coordinates } });
const collection = (...features: GeometryFeature[]): GeometryFeatureCollection => ({ type: 'FeatureCollection', features });
function session() {
  let next = 0; const tool = new DrawingSession(() => `new-${++next}`);
  tool.setGeofencing({ enabled: true, allowed: [area()], excluded: [area('pond', rectangle(4, 4, 2))] });
  return tool;
}

it('contains complete geometry, includes allowed boundaries and rejects all contacts with excluded boundaries', () => {
  const tool = session();
  expect(tool.checkGeofencing([point(0, [0, 2]), line('boundary', [[0, 1], [0, 9]]), polygon('inside')])).toEqual([]);
  expect(tool.checkGeofencing([point('0', [4, 5])])).toEqual([{ featureId: '0', code: 'intersects-excluded-area', areaIds: ['pond'] }]);
  expect(tool.checkGeofencing([line('cross', [[3, 5], [7, 5]])])[0]?.code).toBe('intersects-excluded-area');
  expect(tool.checkGeofencing([point('outside', [-0.000000001, 5])])[0]?.code).toBe('outside-allowed-area');
});

it('uses filled polygons and holes rather than just vertices or bounding boxes', () => {
  const tool = session();
  expect(tool.checkGeofencing([polygon('surrounds', rectangle(3, 3, 4))])[0]?.code).toBe('intersects-excluded-area');
  const holed = rectangle(2, 2, 6); holed.coordinates.push(rectangle(3, 3, 4).coordinates[0]!);
  expect(tool.checkGeofencing([polygon('empty-hole', holed)])).toEqual([]);
  const allowed = rectangle(0, 0, 10); allowed.coordinates.push(rectangle(4, 4, 2).coordinates[0]!);
  tool.setGeofencing({ allowed: [area('with-hole', allowed)], excluded: [] });
  expect(tool.checkGeofencing([point('in-hole', [5, 5])])[0]?.code).toBe('outside-allowed-area');
  expect(tool.checkGeofencing([line('cross-hole', [[3, 5], [7, 5]])])[0]?.code).toBe('outside-allowed-area');
  expect(tool.checkGeofencing([polygon('fills-hole', rectangle(3, 3, 4))])[0]?.code).toBe('outside-allowed-area');
});

it('unions adjacent allowed areas, detects concave segment excursions and checks every multipart component', () => {
  const tool = session(); tool.setGeofencing({ allowed: [area('west', rectangle(0, 0, 5, 10)), area('east', rectangle(5, 0, 5, 10))], excluded: [] });
  expect(tool.checkGeofencing([line('joined', [[1, 2], [9, 2]]), polygon('across', rectangle(3, 2, 4))])).toEqual([]);
  const concave: GeofenceArea['geometry'] = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10], [0, 0]]] };
  tool.setGeofencing({ allowed: [area('concave', concave)] });
  expect(tool.checkGeofencing([line('excursion', [[1, 8], [9, 8]])])[0]?.code).toBe('outside-allowed-area');
  expect(tool.checkGeofencing([{ type: 'Feature', id: 'parts', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[1, 1], [2, 2]], [[11, 1], [12, 2]]] } }])[0]?.code).toBe('outside-allowed-area');
});

it('supports explicit intersection/containment alternatives and unrestricted empty groups', () => {
  const tool = session(); tool.setGeofencing({ allowedMatch: 'intersects', excludedMatch: 'contains' });
  expect(tool.checkGeofencing([line('partial', [[-1, 5], [7, 5]])])).toEqual([]);
  expect(tool.checkGeofencing([line('contained', [[4.5, 5], [5.5, 5]])])[0]?.code).toBe('inside-excluded-area');
  tool.setGeofencing({ allowed: [], excluded: [] }); expect(tool.checkGeofencing([point('anywhere', [80, 80])])).toEqual([]);
});

it('rejects mixed imports and transactions atomically, preserving IDs, selection, history and properties', () => {
  const tool = session(); tool.importGeoJSON(collection(point(0, [1, 1]), point('0', [2, 2]))); tool.clearHistory(); tool.select(0);
  const before = tool.exportGeoJSON(); const state = tool.state;
  expect(() => tool.importGeoJSON(collection(point('good', [1, 2]), point('bad', [5, 5])))).toThrow(GeofencingError);
  expect(() => tool.applyTransaction({ update: [point(0, [2, 1])], delete: ['0'], create: [point('bad', [12, 2])] })).toThrow(GeofencingError);
  expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state).toEqual(state);
  tool.applyTransaction({ update: [point(0, [3, 1])], delete: ['0'], create: [point('new', [2, 3])] });
  expect(tool.undo()?.changes).toHaveLength(3); expect(tool.exportGeoJSON()).toEqual(before);
});

it('keeps invalid drawing/edit previews correctable, allocates no ID for a blocked save and cancels without history', () => {
  let ids = 0; const tool = new DrawingSession(() => ++ids); tool.setGeofencing({ enabled: true, allowed: [area()] });
  tool.start('Point'); tool.add([12, 2]); expect(tool.state).toMatchObject({ canFinish: false, geofencingViolations: [{ featureId: null, code: 'outside-allowed-area', areaIds: ['park'] }] });
  expect(tool.finish()).toBeNull(); expect(ids).toBe(0); expect(tool.state.mode).toBe('draw-point');
  tool.add([2, 2]); expect(tool.state.canFinish).toBe(true); expect(tool.finish()?.id).toBe(1);
  tool.select(1); tool.editSelected(); tool.moveVertex(0, [12, 2]); const draft = tool.getDraft();
  expect(tool.finish()).toBeNull(); expect(tool.getDraft()).toEqual(draft); expect(tool.exportGeoJSON().features[0]?.geometry.coordinates).toEqual([2, 2]);
  tool.moveVertex(0, [3, 2]); tool.finish(); tool.undo(); expect(tool.exportGeoJSON().features[0]?.geometry.coordinates).toEqual([2, 2]);
  tool.clearHistory(); tool.editSelected(); tool.moveVertex(0, [12, 2]); tool.cancel(); expect(tool.state.canUndo).toBe(false);
});

it.each(['Rectangle', 'Circle', 'Ellipse'] as const)('keeps a blocked %s visible and correctable from its original anchor', kind => {
  const tool = session(); tool.start(kind); tool.add([2, 2]); tool.add([12, 12]);
  expect(tool.state.canFinish).toBe(false); expect(tool.getDraft().length).toBeGreaterThan(2); expect(tool.finish()).toBeNull();
  tool.add([2.3, 2.3]); expect(tool.state.canFinish).toBe(true); expect(tool.finish()?.geometry.type).toBe('Polygon');
});

it('checks multipart edits, added parts, hole removal and linked followers as complete final features', () => {
  const tool = session(); const geometry = rectangle(2, 2, 6); geometry.coordinates.push(rectangle(3, 3, 4).coordinates[0]!);
  tool.importGeoJSON(polygon('ring', geometry)); tool.select('ring'); tool.removeHole();
  expect(tool.getHoleRemovalPreview()).not.toBeNull(); expect(tool.state.canFinish).toBe(false); expect(tool.finishHoleRemoval()).toBeNull(); tool.cancel();
  expect(() => tool.deleteHole(1)).toThrow(GeofencingError);
  tool.drawPart(); for (const coordinate of [[12, 1], [14, 1], [14, 3], [12, 3]] as Coordinate[]) tool.add(coordinate);
  expect(tool.state.canFinish).toBe(false); expect(tool.finish()).toBeNull(); tool.cancel();
  tool.importGeoJSON(collection(point('a', [1, 1]), line('b', [[1, 1], [3, 3]])));
  tool.pinVertices([{ featureId: 'a', index: 0 }, { featureId: 'b', index: 0 }]); tool.select('a'); tool.editSelected(); tool.moveVertex(0, [7, 5]);
  expect(tool.getPinnedPreview()).not.toBeNull(); expect(tool.state.geofencingViolations.some(value => value.featureId === 'b')).toBe(true); expect(tool.finish()).toBeNull();
});

it.each(['scale', 'rotation', 'buffer', 'offset'] as const)('retains a blocked %s preview and allows correction without committing', kind => {
  const tool = session(); tool.importGeoJSON(kind === 'offset' ? line('shape', [[1, 1], [3, 1]]) : polygon('shape')); tool.clearHistory(); tool.select('shape');
  if (kind === 'scale') { tool.scaleSelection(); tool.setScaleFactor(20); expect(tool.getScalePreview()).not.toBeNull(); expect(tool.finishScale()).toBeNull(); tool.setScaleFactor(1); }
  if (kind === 'rotation') { tool.rotateSelection([0, 0]); tool.setRotationAngle(180); expect(tool.getRotationPreview()).not.toBeNull(); expect(tool.finishRotation()).toBeNull(); tool.setRotationAngle(0); }
  if (kind === 'buffer') { tool.bufferSelection(500_000); expect(tool.getBufferPreview()).not.toBeNull(); expect(tool.finishBuffer()).toBeNull(); tool.setBufferDistance(1); }
  if (kind === 'offset') { tool.offsetSelection(); tool.setOffsetDistance(-500_000); expect(tool.getOffsetPreview()).not.toBeNull(); expect(tool.finishOffset()).toBeNull(); tool.setOffsetDistance(0); }
  expect(tool.state.canFinish).toBe(true); expect(tool.exportGeoJSON().features).toHaveLength(1); expect(tool.state.canUndo).toBe(false); tool.cancel();
});

it('checks template output, translation and duplication with one shared policy', () => {
  const tool = session(); tool.startTemplate('arrow', { position: [12, 2], size: 50 });
  expect(tool.getTemplatePreview()).not.toBeNull(); expect(tool.finishTemplate()).toBeNull(); expect(tool.state.mode).toBe('draw-template'); tool.cancel();
  tool.importGeoJSON(point('marker', [2, 2])); tool.select('marker'); const before = tool.exportGeoJSON();
  expect(() => tool.previewTranslation([10, 0])).toThrow(GeofencingError); expect(() => tool.translateSelection([10, 0])).toThrow(GeofencingError);
  expect(() => tool.duplicateSelection([10, 0])).toThrow(GeofencingError); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.selectedFeatureIds).toEqual(['marker']);
});

it('blocks a simplified chord through an exclusion while preserving the valid route for correction', () => {
  const tool = session(); tool.importGeoJSON(line('route', [[3, 5], [3, 7], [7, 7], [7, 5]])); tool.select('route'); tool.clearHistory();
  const before = tool.exportGeoJSON(); tool.simplifySelection(); tool.setSimplificationTolerance(1_000_000);
  expect(tool.getSimplificationPreview()).not.toBeNull(); expect(tool.state.geofencingViolations[0]?.code).toBe('intersects-excluded-area'); expect(tool.finishSimplification()).toBeNull();
  tool.setSimplificationTolerance(0); expect(tool.state.canFinish).toBe(true); tool.cancel(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.canUndo).toBe(false);
});

it.each(['union', 'difference', 'intersection', 'split', 'shared-boundary'] as const)('revalidates an active %s result when the host changes the policy', kind => {
  const tool = session(); tool.setGeofencing({ excluded: [] });
  const east = kind === 'shared-boundary' ? rectangle(3, 1, 2) : rectangle(2, 1, 2);
  tool.importGeoJSON(collection(polygon('a'), polygon('b', east))); tool.clearHistory(); tool.selectMany(['a', 'b']);
  if (kind === 'union') tool.unionSelection();
  if (kind === 'difference') tool.differenceSelection();
  if (kind === 'intersection') tool.intersectionSelection();
  if (kind === 'shared-boundary') tool.editSharedBoundary();
  if (kind === 'split') { tool.select('a'); tool.splitSelected(); tool.setSplitLine([[0, 2], [4, 2]]); }
  expect(tool.state.canFinish).toBe(true); const before = tool.exportGeoJSON();
  tool.setGeofencing({ allowed: [area('far', rectangle(7, 7, 2))] }); expect(tool.state.canFinish).toBe(false);
  const finish = { union: () => tool.finishUnion(), difference: () => tool.finishDifference(), intersection: () => tool.finishIntersection(), split: () => tool.finishSplit(), 'shared-boundary': () => tool.finishSharedBoundary() };
  expect(finish[kind]()).toBeNull(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.mode).not.toBe('idle');
  tool.setGeofencing({ allowed: [area()] }); expect(tool.state.canFinish).toBe(true); tool.cancel(); expect(tool.state.canUndo).toBe(false);
});

it('validates cut results, rather than restricting the cutter itself, and allows deletion of an invalid old feature', () => {
  const tool = session(); tool.importGeoJSON(polygon('target')); tool.clearHistory(); tool.select('target'); tool.drawCut();
  for (const coordinate of [[-5, -5], [2, -5], [2, 8], [-5, 8]] as Coordinate[]) tool.add(coordinate);
  expect(tool.state.canFinish).toBe(true); expect(tool.finishCut()?.changes).toHaveLength(1); tool.undo();
  tool.setGeofencing({ enabled: false }); tool.importGeoJSON(point('outside', [12, 2])); tool.setGeofencing({ enabled: true }); tool.select('outside');
  expect(tool.deleteSelection()?.changes).toHaveLength(1); expect(tool.state.canUndo).toBe(false); expect(tool.getHistoryGeofencingViolations('undo')[0]?.featureId).toBe('outside');
});

it('revalidates Undo/Redo against replacement policies without advancing either history stack on failure', () => {
  const tool = session(); tool.importGeoJSON(point(0, [1, 1])); tool.clearHistory(); tool.applyTransaction({ update: [point(0, [9, 1])] });
  const before = tool.exportGeoJSON(); const revision = tool.state.dataRevision;
  tool.setGeofencing({ allowed: [area('east-only', rectangle(8, 0, 2, 3))] });
  expect(tool.state.canUndo).toBe(false); expect(tool.undo()).toBeNull(); expect(tool.exportGeoJSON()).toEqual(before); expect(tool.state.dataRevision).toBe(revision);
  tool.setGeofencing({ enabled: false }); expect(tool.undo()).not.toBeNull();
  tool.setGeofencing({ enabled: true, allowed: [area('west-only', rectangle(0, 0, 3))] }); expect(tool.state.canRedo).toBe(false); expect(tool.redo()).toBeNull();
  tool.setGeofencing({ allowed: [area()] }); expect(tool.redo()).not.toBeNull(); expect(tool.exportGeoJSON()).toEqual(before);
});

it('isolates and validates policy/state/error snapshots, retains drafts on policy changes, and keeps default behavior unrestricted', () => {
  const tool = session(); tool.start('Point'); tool.add([12, 2]); const draft = tool.getDraft();
  const policy = tool.getGeofencing(); policy.allowed[0]!.geometry.coordinates.length = 0; expect(tool.getGeofencing().allowed[0]!.geometry.coordinates.length).toBe(1);
  tool.state.geofencingViolations.length = 0; expect(tool.state.canFinish).toBe(false);
  expect(() => tool.setGeofencing({ allowed: [area('duplicate'), area('duplicate')] })).toThrow(); expect(tool.getDraft()).toEqual(draft);
  tool.setGeofencing({ allowed: [area('larger', rectangle(0, 0, 20))] }); expect(tool.state.canFinish).toBe(true); expect(tool.getDraft()).toEqual(draft); tool.finish();
  const unrestricted = new DrawingSession(() => 1); unrestricted.importGeoJSON(point('outside', [-80, 70])); expect(unrestricted.state.canUndo).toBe(true);
  const violations = new GeofencingPolicy({ enabled: true, excluded: [area()] }).check([{ featureId: 0, geometry: point(0, [1, 1]).geometry }]);
  const error = new GeofencingError(violations); error.violations[0]!.areaIds.length = 0; expect(violations[0]?.areaIds).toEqual(['park']);
});
