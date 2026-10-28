import { describe, expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { GeoJSONImportError } from '../src/core/geojson-import.js';
import type { FeatureId, FeatureProperties, GeometryFeatureCollection, LineFeature } from '../src/core/types.js';

const line = (id: FeatureId = 'line', properties: FeatureProperties = {}): LineFeature => ({
  type: 'Feature', id, properties, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
});
const batch = (...features: unknown[]) => ({ type: 'FeatureCollection', features });
const polygon = () => ({ type: 'Feature', id: 'polygon', properties: null, geometry: {
  type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
} });
function session(): DrawingSession { let id = 0; return new DrawingSession(() => `generated-${++id}`); }

describe('atomic GeoJSON import', () => {
  it('appends mixed features, preserves typed IDs/properties, and round-trips through a fresh session', () => {
    const editor = session(); editor.importGeoJSON(line('existing')); editor.select('existing');
    const input = batch(line(0, { label: 'Road', nested: { tags: ['a', null, true, 3] } }), line('0'), polygon());
    const imported = editor.importGeoJSON(input);
    expect(imported).toEqual(input);
    expect(editor.state).toMatchObject({ featureCount: 4, selectedFeatureId: 'existing', dataRevision: 2 });
    const exported = editor.exportGeoJSON(); const other = session();
    expect(other.importGeoJSON(exported)).toEqual(exported);
    expect(other.exportGeoJSON()).toEqual(exported);
    for (const id of [0, '0', 'existing', 'polygon']) {
      editor.select(id); expect(editor.getSelected()?.id).toBe(id);
    }
  });

  it('preserves empty string and fractional numeric IDs and handles null properties when editing', () => {
    const editor = session(); editor.importGeoJSON(batch(line('', null), line(1.5)));
    editor.select(''); editor.editSelected(); editor.moveVertex(0, [-1, 0]);
    expect(editor.finish()).toMatchObject({ id: '', properties: null });
    editor.select(1.5); expect(editor.deleteSelected()?.id).toBe(1.5);
  });

  it('generates missing IDs only after reserving explicit IDs, and drawing cannot overwrite imported IDs', () => {
    const editor = session();
    const anonymous = { type: 'Feature', properties: {}, geometry: line().geometry };
    const result = editor.importGeoJSON(batch(anonymous, line('generated-1'), line('generated-3')));
    expect(result.features.map((feature) => feature.id)).toEqual(['generated-2', 'generated-1', 'generated-3']);
    editor.start('LineString'); editor.add([2, 2]); editor.add([3, 3]);
    expect(editor.finish()?.id).toBe('generated-4');
    expect(editor.state.featureCount).toBe(4);
  });

  it('fails safely if an ID factory cannot allocate a unique ID', () => {
    const editor = new DrawingSession(() => 'fixed'); editor.importGeoJSON(line('fixed'));
    const before = editor.exportGeoJSON();
    expect(() => editor.importGeoJSON({ type: 'Feature', properties: {}, geometry: line().geometry })).toThrow('unique feature ID');
    expect(editor.exportGeoJSON()).toEqual(before);
    editor.start('LineString'); editor.add([2, 2]); editor.add([3, 3]);
    expect(() => editor.finish()).toThrow('unique feature ID');
    expect(editor.exportGeoJSON()).toEqual(before);
    expect(editor.state.mode).toBe('draw-line');
  });

  it('normalizes clockwise polygons while retaining the first corner, ID, and properties', () => {
    const input = polygon(); input.geometry.coordinates[0]!.reverse();
    const editor = session(); const imported = editor.importGeoJSON(input);
    expect(imported.features[0]).toEqual(polygon());
    expect(input.geometry.coordinates[0]?.[1]).toEqual([0, 4]);
  });

  it('keeps nested input, return values, exports, selections, and saved edits independent', () => {
    const properties = { meta: { tags: ['original'] } };
    const input = line('nested', properties); const editor = session();
    const returned = editor.importGeoJSON(input);
    properties.meta.tags[0] = 'input mutation'; input.geometry.coordinates[0]![0] = 80;
    const mutate = (collection: GeometryFeatureCollection): void => {
      const feature = collection.features[0]!;
      (feature.properties as typeof properties).meta.tags.push('mutated');
      feature.geometry.coordinates.length = 0;
    };
    mutate(returned); mutate(editor.exportGeoJSON());
    editor.select('nested');
    (editor.getSelected()!.properties as typeof properties).meta.tags.push('selected mutation');
    editor.editSelected(); editor.moveVertex(0, [-1, 0]);
    const saved = editor.finish()!;
    (saved.properties as typeof properties).meta.tags.push('saved mutation');
    expect(editor.getSelected()?.properties).toEqual({ meta: { tags: ['original'] } });
    expect(editor.getSelected()?.geometry.coordinates).toEqual([[-1, 0], [1, 1]]);
  });

  it('copies special property names without prototype pollution or renderer metadata leakage', () => {
    const properties: unknown = JSON.parse('{"__proto__":{"polluted":true},"constructor":"kept","__geo_editor_id":"user-value"}');
    const editor = session(); const imported = editor.importGeoJSON({ ...line(), properties });
    expect(imported.features[0]?.properties).toEqual(properties);
    expect(Object.getPrototypeOf(imported.features[0]!.properties)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it.each([
    ['existing duplicate', (): unknown => line('existing'), 'duplicate-id'],
    ['batch duplicate', (): unknown => batch(line('new'), line('new')), 'duplicate-id'],
    ['bad top level', (): unknown => null, 'invalid-geojson'],
    ['JSON text', (): unknown => '{"type":"FeatureCollection","features":[]}', 'invalid-geojson'],
    ['bad collection', (): unknown => ({ type: 'FeatureCollection', features: {} }), 'invalid-geojson'],
    ['sparse collection', (): unknown => ({ type: 'FeatureCollection', features: new Array<unknown>(1) }), 'invalid-geojson'],
    ['missing properties', (): unknown => ({ type: 'Feature', geometry: line().geometry }), 'invalid-properties'],
    ['array properties', (): unknown => ({ ...line(), properties: [] }), 'invalid-properties'],
    ['undefined property', (): unknown => line('new', { bad: undefined } as unknown as FeatureProperties), 'invalid-properties'],
    ['nonfinite property', (): unknown => line('new', { bad: Infinity }), 'invalid-properties'],
    ['Date property', (): unknown => ({ ...line(), properties: { date: new Date() } }), 'invalid-properties'],
    ['null ID', (): unknown => ({ ...line(), id: null }), 'invalid-id'],
    ['nonfinite ID', (): unknown => line(NaN), 'invalid-id'],
    ['multipoint', (): unknown => ({ ...line(), geometry: { type: 'MultiPoint', coordinates: [[0, 0]] } }), 'unsupported-geometry'],
    ['null geometry', (): unknown => ({ ...line(), geometry: null }), 'unsupported-geometry'],
    ['coincident rings', (): unknown => { const p = polygon(); p.geometry.coordinates.push(p.geometry.coordinates[0]!); return p; }, 'ring-intersection'],
    ['missing exterior in sparse rings', (): unknown => ({ ...polygon(), geometry: { type: 'Polygon', coordinates: new Array<unknown>(1) } }), 'invalid-geojson'],
    ['missing hole in sparse rings', (): unknown => { const p = polygon(); p.geometry.coordinates.length = 2; return p; }, 'invalid-geojson'],
    ['3D', (): unknown => ({ ...line(), geometry: { type: 'LineString', coordinates: [[0, 0, 4], [1, 1, 4]] } }), 'invalid-coordinate'],
    ['out of range', (): unknown => ({ ...line(), geometry: { type: 'LineString', coordinates: [[181, 0], [1, 1]] } }), 'invalid-coordinate'],
    ['nonfinite coordinate', (): unknown => ({ ...line(), geometry: { type: 'LineString', coordinates: [[0, NaN], [1, 1]] } }), 'invalid-coordinate'],
    ['line too short', (): unknown => ({ ...line(), geometry: { type: 'LineString', coordinates: [[0, 0]] } }), 'too-few-vertices'],
    ['duplicate line point', (): unknown => ({ ...line(), geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0]] } }), 'duplicate-vertex'],
    ['unclosed ring', (): unknown => { const p = polygon(); p.geometry.coordinates[0]!.pop(); return p; }, 'unclosed-ring'],
    ['crossing polygon', (): unknown => ({ ...polygon(), geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]] } }), 'self-intersection'],
    ['legacy CRS', (): unknown => ({ ...line(), crs: { type: 'name', properties: { name: 'EPSG:3857' } } }), 'unsupported-crs'],
  ] as const)('rejects %s without partial writes or selection/revision changes', (_name, invalid, code) => {
    const editor = session(); editor.importGeoJSON(line('existing')); editor.select('existing');
    const before = editor.exportGeoJSON(); const state = editor.state;
    const value = invalid();
    // Put malformed features after a valid feature to catch partial imports.
    const input = value && typeof value === 'object' && 'type' in value && value.type === 'Feature'
      ? batch(line('valid-first'), value) : value;
    expect(() => editor.importGeoJSON(input)).toThrow(GeoJSONImportError);
    try { editor.importGeoJSON(input); } catch (error) { expect(error).toMatchObject({ code }); }
    expect(editor.exportGeoJSON()).toEqual(before); expect(editor.state).toEqual(state);
  });

  it('reports paths and rejects circular and excessively deep properties', () => {
    const editor = session();
    expect(() => editor.importGeoJSON(batch(line(), { ...line('bad'), properties: { bad: undefined } })))
      .toThrow('$.features[1].properties.bad');
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => editor.importGeoJSON({ ...line(), properties: circular })).toThrow('acyclic');
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 103; i++) deep = { child: deep };
    expect(() => editor.importGeoJSON({ ...line(), properties: deep })).toThrow('100 containers');
    expect(editor.state.featureCount).toBe(0);
    let boundary: Record<string, unknown> = { value: true };
    for (let i = 1; i < 100; i++) boundary = { child: boundary };
    expect(() => editor.importGeoJSON({ ...line(), properties: boundary })).not.toThrow();
    expect(() => editor.importGeoJSON({ ...line('too-deep'), properties: { child: boundary } })).toThrow('100 containers');
  });

  it('keeps empty imports inert and blocks importing during drawing or editing', () => {
    const editor = session(); expect(editor.importGeoJSON(batch())).toEqual(batch());
    expect(editor.state.dataRevision).toBe(0);
    editor.start('LineString'); editor.add([0, 0]);
    expect(() => editor.importGeoJSON(line())).toThrow('Finish or cancel');
    expect(editor.getDraft()).toEqual([[0, 0]]); editor.cancel();
    editor.importGeoJSON(line()); editor.select('line'); editor.editSelected();
    expect(() => editor.importGeoJSON(batch())).toThrow('Finish or cancel');
    expect(editor.state).toMatchObject({ mode: 'edit-line', featureCount: 1, dataRevision: 1 });
  });
});
