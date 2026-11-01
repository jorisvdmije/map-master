import { expect, it, vi } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { GeoJSONImportError } from '../src/core/geojson-import.js';
import { defaultShapeTemplates, type ShapeTemplate } from '../src/core/shape-templates.js';
import { geometryParts } from '../src/core/geometry.js';
import { project } from '../src/core/mercator-transform.js';
import type { Coordinate, GeometryFeatureCollection, PolygonFeature } from '../src/index.js';

const session = (templates?: ShapeTemplate[]) => { let id = 0; return new DrawingSession(() => ++id, 100, [], templates); };
const polygon = (id: string | number = 'source'): PolygonFeature => ({ type: 'Feature', id,
  properties: { name: 'Custom shape', nested: { tags: ['a'] } }, geometry: { type: 'Polygon', coordinates: [
    [[0, 0], [0.002, 0], [0.002, 0.001], [0, 0.001], [0, 0]],
    [[0.0004, 0.0002], [0.0004, 0.0006], [0.0008, 0.0006], [0.0008, 0.0002], [0.0004, 0.0002]],
  ] } });
const group = (): ShapeTemplate => ({ id: 'group', label: 'Building and path', data: { type: 'FeatureCollection', features: [polygon(0), {
  type: 'Feature', id: '0', properties: null, geometry: { type: 'LineString', coordinates: [[0, -0.001], [0.002, -0.001]] },
}] } });
function spans(collection: GeometryFeatureCollection): Coordinate {
  const points = collection.features.flatMap(feature => geometryParts(feature.geometry).flatMap(part => part.type === 'Point' ? [part.coordinates] : part.type === 'LineString' ? part.coordinates : part.coordinates.flat())).map(project);
  return [Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]))];
}

it('ships valid arrow and star definitions, with isolated source data and no history changes', () => {
  const tool = session(); const templates = tool.getShapeTemplates();
  expect(templates.map(template => template.id)).toEqual(['arrow', 'star']);
  const first = templates[0]!.data as GeometryFeatureCollection; first.features[0]!.properties!.name = 'Changed';
  expect(tool.getShapeTemplates()[0]?.data).not.toEqual(first); expect(defaultShapeTemplates()[0]?.label).toBe('Arrow');
  expect(tool.state).toMatchObject({ mode: 'idle', featureCount: 0, canUndo: false });
});

it('previews cursor placement without anchoring, allocating IDs or committing until Finish', () => {
  const createId = vi.fn(() => 'placed'); const tool = new DrawingSession(createId);
  tool.startTemplate('star'); expect(tool.state).toMatchObject({ mode: 'draw-template', vertexCount: 0, canFinish: false });
  expect(tool.getTemplatePreview()).toBeNull(); expect(tool.getTemplatePreview([4, 52])?.features).toHaveLength(1);
  expect(tool.finishTemplate()).toBeNull(); expect(tool.getTemplateDraft()?.position).toBeNull();
  tool.add([4, 52]); expect(tool.state).toMatchObject({ vertexCount: 1, canFinish: true });
  expect(tool.getDraftRings()).toBeNull();
  const before = tool.getTemplateDraft(); tool.startTemplate('star', { size: 900 }); expect(tool.getTemplateDraft()).toEqual(before);
  expect(createId).not.toHaveBeenCalled(); expect(tool.exportGeoJSON().features).toEqual([]);
  const preview = tool.getTemplatePreview()!; const event = tool.finishTemplate()!;
  expect(createId).toHaveBeenCalledOnce(); expect(event.changes[0]?.after).toEqual({ ...preview.features[0], id: 'placed' });
  expect(tool.getTemplateDraft()).toBeNull(); const saved = tool.exportGeoJSON();
  tool.undo(); expect(tool.state.featureCount).toBe(0); tool.redo(); expect(tool.exportGeoJSON()).toEqual(saved);
});

it('transforms the original baseline, anchors the bounds center and preserves holes and properties in a group transaction', () => {
  const tool = session([group()]); tool.startTemplate('group', { position: [4, 52], size: 400 });
  const original = tool.getTemplatePreview()!; const [width, height] = spans(original);
  expect(Math.max(width, height) * 6_378_137).toBeCloseTo(400, 5);
  tool.setTemplatePlacement({ size: 800, rotation: 90 }); const rotated = spans(tool.getTemplatePreview()!);
  expect(rotated[0]).toBeCloseTo(height * 2, 12); expect(rotated[1]).toBeCloseTo(width * 2, 12);
  tool.setTemplatePlacement({ size: 400, rotation: 360 }); expect(tool.getTemplatePreview()).toEqual(original);
  const event = tool.finishTemplate()!; expect(event.changes).toHaveLength(2);
  expect(tool.getSelection().map(feature => feature.id)).toEqual([1, 2]);
  expect(tool.getSelection()[0]?.properties).toEqual(polygon().properties);
  expect((tool.getSelection()[0]?.geometry as PolygonFeature['geometry']).coordinates).toHaveLength(2);
  tool.undo(); expect(tool.state.canUndo).toBe(false); expect(tool.state.featureCount).toBe(0);
  tool.redo(); expect(tool.exportGeoJSON().features.map(feature => feature.id)).toEqual([1, 2]);
  const other = session(); other.importGeoJSON(tool.exportGeoJSON()); expect(other.exportGeoJSON()).toEqual(tool.exportGeoJSON());
});

it('changes template and position without losing size/rotation, and protects independent snapshots', () => {
  const tool = session(); tool.startTemplate('arrow', { position: [4, 52], size: 500, rotation: 25 });
  tool.setTemplatePlacement({ templateId: 'star' }); expect(tool.getTemplateDraft()).toEqual({ templateId: 'star', position: [4, 52], size: 500, rotation: 25 });
  const draft = tool.getTemplateDraft()!; draft.position![0] = 90;
  const preview = tool.getTemplatePreview()!; preview.features[0]!.properties!.name = 'Changed';
  expect(tool.getTemplateDraft()?.position).toEqual([4, 52]); expect(tool.getTemplatePreview()).not.toEqual(preview);
  tool.add([5, 53]); expect(tool.getTemplateDraft()?.position).toEqual([5, 53]);
  tool.setTemplatePlacement({ position: null }); expect(tool.state.canFinish).toBe(false); tool.cancel();
  expect(tool.exportGeoJSON().features).toEqual([]); expect(tool.state.canUndo).toBe(false);
});

it.each([
  { size: 0 }, { size: -1 }, { size: Infinity }, { rotation: NaN }, { position: [181, 0] }, { position: [0, 91] },
  { position: [0] }, { position: [0, 0, 1] }, { position: ['0', 0] }, { templateId: 'missing' }, { unknown: true }, { size: undefined },
])('rejects malformed patches atomically: %j', patch => {
  const tool = session(); tool.startTemplate('arrow', { position: [4, 52] }); const before = tool.getTemplateDraft(); const preview = tool.getTemplatePreview();
  expect(() => tool.setTemplatePlacement(patch as never)).toThrow();
  expect(tool.getTemplateDraft()).toEqual(before); expect(tool.getTemplatePreview()).toEqual(preview);
  expect(tool.exportGeoJSON().features).toEqual([]);
});

it('rejects out-of-world and degenerate previews without committing and recovers after correction', () => {
  const tool = session(); tool.startTemplate('arrow', { position: [180, 0] });
  expect(tool.state).toMatchObject({ templateError: 'template-out-of-bounds', canFinish: false }); expect(tool.finishTemplate()).toBeNull();
  tool.setTemplatePlacement({ position: [0, 86] }); expect(tool.state.templateError).toBe('template-out-of-bounds');
  tool.setTemplatePlacement({ position: [4, 52], size: Number.MIN_VALUE }); expect(tool.state.templateError).toBe('template-invalid-result');
  tool.setTemplatePlacement({ size: Number.MAX_VALUE }); expect(tool.state.templateError).toBe('template-out-of-bounds');
  tool.setTemplatePlacement({ size: 200 }); expect(tool.state).toMatchObject({ templateError: null, canFinish: true });
  expect(tool.finishTemplate()?.changes).toHaveLength(1);
});

it('validates whole libraries atomically, handles missing/typed source IDs and prevents replacing an active definition', () => {
  const tool = session(); const before = tool.getShapeTemplates();
  expect(() => tool.setShapeTemplates([group(), { id: 'bad', label: 'Bad', data: { ...polygon(), geometry: { type: 'Polygon', coordinates: [] } } }])).toThrow(GeoJSONImportError);
  expect(tool.getShapeTemplates()).toEqual(before); expect(() => tool.setShapeTemplates([group(), group()])).toThrow(RangeError);
  const anonymous = { type: 'Feature', properties: null, geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] } };
  tool.setShapeTemplates([{ id: 'line', label: '<img src=x>', data: anonymous as never }]);
  tool.startTemplate(); expect(() => tool.setShapeTemplates([])).toThrow(); expect(() => tool.start('Point')).toThrow();
  expect(() => tool.startTemplate('missing')).toThrow(); tool.cancel(); tool.setShapeTemplates([]); expect(() => tool.startTemplate()).toThrow();
  tool.setShapeTemplates([group()]); tool.startTemplate(); expect(() => tool.startTemplate('group', { rotation: NaN })).toThrow();
});

it.each([
  { type: 'FeatureCollection', features: [] },
  { type: 'Feature', id: 'point', properties: null, geometry: { type: 'Point', coordinates: [0, 0] } },
  { type: 'Feature', id: 'line', properties: null, geometry: { type: 'LineString', coordinates: [[179, 0], [-179, 0]] } },
  { type: 'Feature', id: 'line', properties: null, geometry: { type: 'LineString', coordinates: [[0, 86], [0.1, 86]] } },
])('rejects empty, zero-extent, polar and dateline templates: %j', data => {
  expect(() => session([{ id: 'bad', label: 'Bad', data: data as never }])).toThrow();
});

it('keeps existing locked features intact, creates with new IDs, and applies locks to duplication and history as usual', () => {
  const tool = session([group()]); tool.importGeoJSON(polygon('existing')); tool.select('existing'); tool.setLockedFeatureIds(['existing']); tool.clearHistory();
  tool.startTemplate('group', { position: [4, 52] }); const event = tool.finishTemplate()!;
  expect(tool.getFeature('existing')).toEqual(polygon('existing')); const id = event.changes[0]!.after!.id;
  tool.setLockedFeatureIds([id]); expect(tool.undo()).toBeNull(); tool.setLockedFeatureIds([]);
  const saved = tool.exportGeoJSON(); tool.duplicateSelection([0.001, 0]); tool.undo(); expect(tool.exportGeoJSON()).toEqual(saved);
  tool.undo(); expect(tool.exportGeoJSON().features).toEqual([polygon('existing')]);
});

it('reserves all new IDs before committing and retains a recoverable draft when allocation fails', () => {
  let next = 0; let fail = true; const tool = new DrawingSession(() => fail ? 'same' : ++next, 100, [], [group()]);
  tool.startTemplate('group', { position: [4, 52] }); expect(() => tool.finishTemplate()).toThrow('unique feature ID');
  expect(tool.exportGeoJSON().features).toEqual([]); expect(tool.state.mode).toBe('draw-template');
  fail = false; expect(tool.finishTemplate()?.changes).toHaveLength(2); tool.undo(); expect(tool.state.canUndo).toBe(false);
});
