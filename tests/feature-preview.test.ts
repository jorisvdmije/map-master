import { expect, it } from 'vitest';
import { featurePreview, resolveFeaturePreview, measure, formatArea, formatDistance, type GeometryFeature } from '../src/index.js';

const point: GeometryFeature = { type: 'Feature', id: 7, properties: { name: 'Meetpunt 12', status: 'Active', active: false, missing: null, nested: { safe: '<script>' }, mapMasterLayer: 'default' }, geometry: { type: 'Point', coordinates: [4.895678, 52.371234] } };
it('builds a compact marker preview in latitude/longitude order without mutation or metadata', () => {
  const before = structuredClone(point); const result = featurePreview(point)!;
  expect(result.title).toBe('Meetpunt 12'); expect(result.rows).toHaveLength(5);
  expect(result.rows.slice(-2)).toEqual([{ label: 'Latitude', value: '52.371234' }, { label: 'Longitude', value: '4.895678' }]);
  expect(result.omittedFields).toBe(1); expect(JSON.stringify(result)).not.toContain('mapMasterLayer'); expect(point).toEqual(before);
});
it('chooses exact own keys, labels, ordering and safe JSON/null/boolean values', () => {
  const properties: GeometryFeature['properties'] = JSON.parse('{"name":"<img src=x>","__proto__":"safe"," spaced ":false,"nested":{"a":1},"value":null}') as GeometryFeature['properties'];
  const result = featurePreview({ ...point, properties }, { fields: [{ key: ' spaced ', label: 'Active' }, { key: '__proto__' }, { key: 'nested' }, { key: 'value' }, { key: 'inherited' }], geometry: { coordinates: false } })!;
  expect(result.title).toBe('<img src=x>');
  expect(result.rows).toEqual([{ label: 'Active', value: 'false' }, { label: '__proto__', value: 'safe' }, { label: 'nested', value: '{"a":1}' }, { label: 'value', value: 'null' }]);
  expect(featurePreview(point, { fields: [], titleProperty: null, geometry: { coordinates: false } })).toEqual({ title: '7', rows: [], omittedFields: 0 });
});
it('formats number/date fields, respects units/locale and falls back for incompatible values', () => {
  const feature = { ...point, properties: { amount: 1234.5678, date: '2026-11-03', invalid: 'not a date', number: '001' } };
  const result = featurePreview(feature, { locale: 'nl', fields: [{ key: 'amount', format: 'number', decimals: 1 }, { key: 'date', format: 'date' }, { key: 'invalid', format: 'date' }, { key: 'number', format: 'number' }], geometry: { coordinates: false } })!;
  expect(result.rows.map(row => row.value)).toEqual(['1.234,6', '3 nov 2026', 'not a date', '001']);
});
it('measures polygon holes/multipart and line lengths using the public spherical measurement contract', () => {
  const polygon: GeometryFeature = { type: 'Feature', id: 'area', properties: null, geometry: { type: 'MultiPolygon', coordinates: [
    [[[4, 52], [4.02, 52], [4.02, 52.02], [4, 52.02], [4, 52]], [[4.005, 52.005], [4.005, 52.01], [4.01, 52.01], [4.01, 52.005], [4.005, 52.005]]],
    [[[5, 52], [5.01, 52], [5.01, 52.01], [5, 52.01], [5, 52]]],
  ] } };
  const measurement = measure(polygon.geometry); const result = featurePreview(polygon, { units: 'imperial' })!;
  expect(result.rows).toEqual([{ label: 'Area', value: formatArea(measurement.area, 'imperial') }, { label: 'Perimeter', value: formatDistance(measurement.perimeter, 'imperial') }]);
  expect(featurePreview(polygon, { geometry: { area: false } })!.rows.map(row => row.label)).toEqual(['Perimeter']);
  const line: GeometryFeature = { ...point, geometry: { type: 'MultiLineString', coordinates: [[[4, 52], [4.01, 52]], [[4, 52], [4, 52.01]]] } };
  expect(featurePreview(line)!.rows.at(-1)).toEqual({ label: 'Length', value: formatDistance(measure(line.geometry).length) });
});
it('bounds long values and isolates configuration, with explicit disabling and no implicit coercion', () => {
  const config = { fields: [{ key: 'status', label: 'Status' }] }; const resolved = resolveFeaturePreview(config);
  config.fields[0]!.label = 'Changed'; expect(resolved.fields![0]!.label).toBe('Status');
  expect(featurePreview(point, { enabled: false })).toBeNull();
  const result = featurePreview({ ...point, properties: { name: 'x'.repeat(400), long: 'v'.repeat(2000) } })!;
  expect(result.title).toHaveLength(201); expect(result.rows[0]!.value).toHaveLength(1001);
});
it.each([null, [], { enabled: 'yes' }, { fields: [{}] }, { fields: [{ key: 'name' }, { key: 'name' }] }, { fields: [{ key: 'mapMasterLayer' }] }, { fields: [{ key: 'x', decimals: 99 }] }, { geometry: { width: true } }, { maxRows: 1 }, { maxRows: NaN }, { locale: 'bad_locale' }, { units: 'miles' }, { surprise: true }])('rejects invalid preview configuration %j', value => {
  expect(() => resolveFeaturePreview(value as never)).toThrow();
});
