import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { areasAt, contains, examplePoint, selectedPoint, reportExport, reportMetrics, reportCsv, reportHref, liveResult, areaShape } from '../src/features/area-report/model.ts';
import { searchAddresses } from '../src/features/area-report/address.ts';
const snapshot = JSON.parse(readFileSync(new URL('../src/features/housing/snapshot.json', import.meta.url)));
const concert = snapshot.data.features.find(row => row.properties.name === 'Concertgebouwbuurt');
const square = (outer, holes = []) => ({ type: 'Feature', properties: { ...concert.properties }, geometry: { type: 'Polygon', coordinates: [outer, ...holes] } });
const ring = (x, y, r) => [[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r],[x-r,y-r]];

test('all real Amsterdam areas get an in-area example point and a finite display shape', () => {
  for (const area of snapshot.data.features) {
    const coordinates = examplePoint(area);
    assert.ok(contains(area, coordinates), area.properties.code);
    const shape = areaShape(area, { coordinates });
    assert.ok(!/NaN|Infinity/.test(shape.path)); assert.ok(shape.point.every(Number.isFinite));
  }
});
test('spatial joins respect holes, multipart areas and shared boundaries', () => {
  const area = square(ring(5, 52, 1), [ring(5, 52, .5)]);
  assert.equal(areasAt([area], [5, 52]).length, 0);
  const point = examplePoint(area); assert.ok(contains(area, point)); assert.notDeepEqual(point, [5, 52]);
  assert.equal(areasAt([square(ring(4, 52, 1)), square(ring(6, 52, 1))], [5, 52]).length, 2);
  const multipart = { ...area, geometry: { type: 'MultiPolygon', coordinates: [area.geometry.coordinates, [ring(10, 52, .2)]] } };
  assert.equal(areasAt([multipart], [10, 52]).length, 1);
});
test('invalid or out-of-area shared points fall back to an explicitly labelled example', () => {
  for (const query of ['lng=&lat=', 'lng=NaN&lat=52', 'lng=181&lat=52', 'lng=0&lat=0', 'lng=4.8', 'lat=52']) {
    const point = selectedPoint(concert, new URLSearchParams(query));
    assert.equal(point.kind, 'example'); assert.ok(contains(concert, point.coordinates));
  }
  const point = examplePoint(concert), href = reportHref(concert.properties.code, point);
  const read = selectedPoint(concert, new URL(href, 'https://local.example').searchParams);
  assert.equal(read.kind, 'shared'); assert.deepEqual(read.coordinates, point);
});
test('report retains source-specific years and unknowns across all 25 indicators', () => {
  const rows = reportMetrics(concert, snapshot.meta);
  assert.equal(rows.length, 25);
  const get = key => rows.find(row => row.key === key);
  assert.equal(get('woz').referenceYear, 2024); assert.equal(get('woz').tableYear, 2025);
  assert.equal(get('education').tableYear, 2024); assert.equal(get('education').value, null);
  assert.equal(get('gas').referenceYear, null); assert.equal(get('newHomes').value, 0);
  assert.equal(get('woz').value, 1348000);
});
test('JSON and CSV exports keep geometry, definitions, missing values and failed refresh status', () => {
  const point = selectedPoint(concert, new URLSearchParams());
  const environment = { trees: liveResult({ data: { count: 0 }, isFetching: false, error: new Error('offline') }), noise: liveResult({ isFetching: false, error: new Error('offline') }) };
  const exported = reportExport(concert, snapshot.meta, point, environment);
  assert.equal(exported.environment.trees.status, 'stale-after-error'); assert.equal(exported.environment.noise.status, 'unavailable');
  assert.equal(exported.provenance.sha256, snapshot.meta.sha256); assert.equal(exported.point.kind, 'example');
  assert.deepEqual(exported.area.geometry, concert.geometry);
  const csv = reportCsv(concert, snapshot.meta);
  assert.equal(csv.split('\r\n').length, 26); assert.ok(csv.includes('"1348000";"€";"2025";"2024"'));
  assert.ok(!csv.includes('"null"')); assert.ok(csv.includes('https://www.cbs.nl/nl-nl/cijfers/detail/85984NED'));
  const hostile = { ...concert, properties: { ...concert.properties, name: '=SUM(A1)' } };
  assert.ok(reportCsv(hostile, snapshot.meta).includes('"\'=SUM(A1)"'));
});
test('live results distinguish not requested, pending, zero, missing value and stale data', () => {
  assert.equal(liveResult({ isFetching: false }).status, 'not-requested');
  assert.equal(liveResult({ isFetching: true }).status, 'loading');
  assert.equal(liveResult({ data: 0, isFetching: false }).data, 0);
  assert.equal(liveResult({ data: { decibels: null }, isFetching: false }).status, 'success');
});
const address = { id: 'adr-test', type: 'adres', gemeentecode: '0363', weergavenaam: 'Concertgebouwplein 10, Amsterdam', centroide_ll: 'POINT(4.87949023 52.35642539)' };
const signal = () => new AbortController().signal;
test('address search uses the Amsterdam address filter and preserves exact coordinates', async () => {
  const results = await searchAddresses('Concertgebouwplein 10', signal(), async url => {
    assert.equal(url.origin, 'https://api.pdok.nl'); assert.equal(url.searchParams.get('fq'), 'type:adres AND gemeentecode:0363');
    return Response.json({ response: { docs: [address] } });
  });
  assert.equal(results[0].kind, 'address'); assert.deepEqual(results[0].coordinates, [4.87949023, 52.35642539]);
  assert.equal(areasAt(snapshot.data.features, results[0].coordinates)[0].properties.code, concert.properties.code);
});
test('address search rejects non-Amsterdam, duplicate and malformed records', async () => {
  for (const docs of [[{ ...address, gemeentecode: '0344' }], [{ ...address, type: 'buurt' }], [{ ...address, centroide_ll: 'POINT(300 52)' }], [address, address], [{ ...address, centroide_ll: 'bad' }], [null]]) {
    await assert.rejects(searchAddresses('address', signal(), async () => Response.json({ response: { docs } })));
  }
  await assert.rejects(searchAddresses('ab', signal(), async () => assert.fail('Must not fetch')));
  await assert.rejects(searchAddresses('valid', signal(), async () => new Response('', { status: 503 })));
  await assert.rejects(searchAddresses('valid', AbortSignal.abort(), async () => assert.fail('Must not fetch')));
  assert.deepEqual(await searchAddresses('valid', signal(), async () => Response.json({ response: { docs: [] } })), []);
});
