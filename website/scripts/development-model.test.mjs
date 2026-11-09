import assert from 'node:assert/strict';
import test from 'node:test';
import Papa from 'papaparse';
import { change, compare, comparisonCsv, crossesBreak, defaults, exclusion, rank, timeline, validPeriod, valueAt } from '../src/features/development/model.ts';
import { loadDevelopment } from '../src/features/development/data.ts';

const period = { start: 2024, end: 2026 };
const filters = { ...defaults, ...period };
const series = (values) => Object.fromEntries([2024, 2025, 2026].map((year, i) => [year, values[i]]));
const area = (patch = {}) => ({
  code: 'BU0363AB03',
  name: 'Testbuurt',
  woz: series([200000, 250000, 300000]),
  homes: series([100, 110, 120]),
  ...patch,
});
const feature = (code = 'BU0363AB03', geometry = { type: 'Polygon', coordinates: [[[4.8,52.3],[4.9,52.3],[4.9,52.4],[4.8,52.3]]] }) => ({ type: 'Feature', properties: { code, name: 'Testbuurt' }, geometry });
const fixture = () => ({
  snapshot: {
    meta: { retrievedAt: '2026-11-09T12:00:00Z', years: [2024,2025,2026], geometryVintage: '2022-03-24', sha256: 'a'.repeat(64), sources: [] },
    areas: [area()],
    city: area({ code: 'GM0363', name: 'Amsterdam' }),
  },
  geometry: { type: 'FeatureCollection', features: [feature()] },
});
const respond = (input, calls = []) => async (url, options) => {
  calls.push({ url, options });
  return Response.json(url.endsWith('-geometry.json') ? input.geometry : input.snapshot);
};
const load = (input, request = respond(input)) => loadDevelopment(new AbortController().signal, request);

test('WOZ change uses the selected endpoints, preserving losses and unknowns', () => {
  const comparison = compare(area(), period);
  assert.equal(comparison.startValue, 200000);
  assert.equal(comparison.endValue, 300000);
  assert.equal(comparison.growth, 50);
  assert.equal(change(200000, 150000), -25);
  assert.equal(change(200000, 0), -100);
  for (const values of [[0,100],[null,100],[100,null]]) assert.equal(change(...values), null);
  for (const value of [null, undefined, -1, Infinity, NaN, '200000']) {
    assert.equal(valueAt({ 2024: value }, 2024), null);
    assert.equal(compare(area({ woz: series([value,250000,300000]) }), period), null);
  }
  assert.equal(valueAt({ 2024: 0 }, 2024), 0);
  assert.equal(compare(area({ woz: series([0,100000,200000]) }), period), null);
  assert.equal(compare(area({ woz: series([200000,null,300000]) }), period).growth, 50, 'An unpublished middle-year WOZ does not invent a value or suppress valid endpoint growth');
});

test('invalid periods cannot create an unbounded or reversed timeline', () => {
  for (const invalid of [{ start:2026,end:2024 },{ start:2026,end:2026 },{ start:2024.5,end:2026 },{ start:1999,end:2026 },{ start:2024,end:2101 },{ start:NaN,end:2026 }]) {
    assert.equal(validPeriod(invalid), false);
    assert.equal(compare(area(), invalid), null);
    assert.deepEqual(timeline(area(), invalid, true), []);
  }
});

test('minimum housing stock applies independently to both selected endpoints', () => {
  assert.equal(exclusion(area({ homes:series([99,200,200]) }), filters), 'small-stock');
  assert.equal(exclusion(area({ homes:series([200,200,99]) }), filters), 'small-stock');
  assert.equal(exclusion(area({ homes:series([null,200,200]) }), filters), 'missing-stock');
  assert.equal(exclusion(area({ homes:series([200,200,null]) }), filters), 'missing-stock');
  assert.equal(exclusion(area({ homes:series([100,100,100]) }), filters), null);
  assert.equal(exclusion(area({ homes:series([null,null,null]) }), { ...filters, minimum:0, stockFilter:false }), null, 'Only explicitly disabling both stock constraints admits unknown stock');
});

test('new-build filter observes every intermediate stock count, including reversals', () => {
  const builtAndRemoved = area({ homes:series([100,160,100]) });
  assert.equal(compare(builtAndRemoved, period).stockChange, 0);
  assert.ok(Math.abs(compare(builtAndRemoved, period).maxStockChange - 60) < 1e-10);
  assert.equal(exclusion(builtAndRemoved, filters), 'changed-stock');
  assert.equal(exclusion(builtAndRemoved, { ...filters,stockFilter:false }), null);
  assert.equal(exclusion(area({ homes:series([200,100,200]) }), filters), 'changed-stock', 'Temporary demolition also changes the population being averaged');
  assert.equal(exclusion(area({ homes:series([100,120,100]) }), filters), null, 'The maximum deviation threshold includes its boundary');
  assert.equal(exclusion(area({ homes:series([100,120.001,100]) }), filters), 'changed-stock');
  assert.equal(exclusion(area({ homes:series([100,null,100]) }), filters), 'missing-stock');
  assert.equal(exclusion(area({ homes:series([100,null,100]) }), { ...filters,stockFilter:false }), null);
});

test('ranking separates eligibility counts from search and sorts equal growth by official code', () => {
  const rows = [
    area({ code:'BU0363AB05',name:'Noord',woz:series([200000,300000,400000]) }),
    area({ code:'BU0363AB04',name:'Zuid' }),
    area({ code:'BU0363AB03',name:'NOORD West' }),
    area({ code:'BU0363AB06',woz:series([null,null,200000]) }),
    area({ code:'BU0363AB07',homes:series([50,50,50]) }),
    area({ code:'BU0363AB08',homes:series([100,null,100]) }),
    area({ code:'BU0363AB09',homes:series([100,150,100]) }),
    area({ code:'BU0363AB10',breakYears:[2025] }),
  ];
  const result = rank(rows, { ...filters,query:' noord ' });
  assert.equal(result.eligible, 3);
  assert.deepEqual(result.rows.map((row) => row.area.code), ['BU0363AB05','BU0363AB03']);
  assert.deepEqual(result.excluded, { 'boundary-break':1,'missing-woz':1,'small-stock':1,'missing-stock':1,'changed-stock':1 });
  assert.equal(result.eligible + Object.values(result.excluded).reduce((sum,n) => sum+n,0), rows.length);
  assert.deepEqual(rank(rows, { ...filters,query:'' }, true).rows.map((row) => row.area.code), ['BU0363AB03','BU0363AB04','BU0363AB05']);
  assert.equal(rank(rows, { ...filters,query:'bu0363ab04' }).rows[0].area.name, 'Zuid');
  assert.deepEqual(rows.map((row) => row.code), ['BU0363AB05','BU0363AB04','BU0363AB03','BU0363AB06','BU0363AB07','BU0363AB08','BU0363AB09','BU0363AB10'], 'Ranking must preserve source order');
});

test('geographic breaks exclude growth across a break but allow periods beginning with the new geography', () => {
  const changed = area({ breakYears:[2025] });
  assert.equal(crossesBreak(changed, period), true);
  assert.equal(compare(changed, period), null);
  assert.equal(exclusion(changed, filters), 'boundary-break');
  assert.equal(crossesBreak(changed, { start:2025,end:2026 }), false);
  assert.equal(compare(changed, { start:2025,end:2026 }).growth, 100*(300000/250000-1));
  assert.equal(crossesBreak(area({ breakYears:[2024] }), period), false);
});

test('indexed timelines retain missing years and stop the baseline index at a geographic break', () => {
  assert.deepEqual(timeline(area(), period, true).map((point) => point.value), [100,125,150]);
  assert.deepEqual(timeline(area({ woz:series([200000,null,300000]) }), period, true), [
    { year:2024,value:100,raw:200000 },
    { year:2025,value:null,raw:null },
    { year:2026,value:150,raw:300000 },
  ]);
  assert.deepEqual(timeline(area({ woz:series([null,250000,300000]) }), period, true).map((point) => point.value), [null,null,null]);
  assert.deepEqual(timeline(area({ breakYears:[2025] }), period, true).map((point) => point.value), [100,null,null]);
  assert.deepEqual(timeline(area({ breakYears:[2025] }), period, false).map((point) => point.value), [200000,250000,300000], 'Raw values remain inspectable on both sides of the break');
});

test('CSV retains negative numbers, source years, valuation dates, stock constraints and safe quoted names', () => {
  const target = area({ name:'=SUM(A1); "test"',woz:series([200000,175000,150000]),homes:series([200,200,180]) });
  const csv = comparisonCsv([compare(target, period)], filters);
  assert.ok(csv.startsWith('\uFEFF'));
  const parsed = Papa.parse(csv, { header:true,delimiter:';' });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data[0].buurt, '\'=SUM(A1); "test"');
  assert.equal(parsed.data[0].woz_verandering_pct, '-25');
  assert.ok(!csv.includes('"\'-25"'), 'Negative numeric cells remain numbers when imported');
  assert.equal(parsed.data[0].bronjaar_start, '2024');
  assert.equal(parsed.data[0].bronjaar_eind, '2026');
  assert.equal(parsed.data[0].waardepeildatum_start, '2023-01-01');
  assert.equal(parsed.data[0].waardepeildatum_eind, '2025-01-01');
  assert.equal(parsed.data[0].voorraadfilter, 'true');
  assert.equal(parsed.data[0].voorraadgrens_pct, '20');
  const unknown = compare(area({ homes:series([null,null,null]) }), period);
  assert.equal(Papa.parse(comparisonCsv([unknown], filters), { header:true,delimiter:';' }).data[0].voorraad_verandering_pct, '');
  assert.ok(!comparisonCsv([unknown], filters).includes('"null"'));
});

test('snapshot loader fetches only the two local assets and forwards the same cancellation signal', async () => {
  const input = fixture(), calls = [], controller = new AbortController();
  const loaded = await loadDevelopment(controller.signal, respond(input,calls));
  assert.deepEqual(loaded, input);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({url,options}) => url.startsWith('/') && options.signal === controller.signal));
  assert.ok(calls.some(({url}) => url.endsWith('/data/amsterdam-development.json')));
  assert.ok(calls.some(({url}) => url.endsWith('/data/amsterdam-development-geometry.json')));
});

test('snapshot loader never turns an HTTP or JSON failure into successful partial data', async () => {
  await assert.rejects(load(fixture(), async () => new Response('Unavailable',{ status:503 })), /kon niet worden geladen/);
  await assert.rejects(load(fixture(), async () => new Response('not json',{ status:200 })), SyntaxError);
});

test('snapshot loader rejects duplicate identifiers, incomplete series and malformed year metadata', async () => {
  for (const mutate of [
    (input) => input.snapshot.areas.push(area()),
    (input) => { input.snapshot.city.code = input.snapshot.areas[0].code; },
    (input) => { delete input.snapshot.areas[0].woz[2025]; },
    (input) => { input.snapshot.areas[0].homes[2025] = -1; },
    (input) => { input.snapshot.areas[0].woz[2025] = '250000'; },
    (input) => { input.snapshot.meta.years = [2024,2026]; },
    (input) => { input.snapshot.meta.years = [2024,2025,2025]; },
    (input) => { input.snapshot.meta.retrievedAt = 'unknown'; },
  ]) {
    const input = fixture(); mutate(input);
    await assert.rejects(load(input), /onverwacht formaat/);
  }
});

test('snapshot loader requires a unique exact geometry match for every statistical area', async () => {
  for (const mutate of [
    (input) => { input.geometry.features = []; },
    (input) => input.geometry.features.push(feature()),
    (input) => { input.geometry.features[0].properties.code = 'BU0363ZZ99'; },
    (input) => { input.geometry.features[0].geometry = { type:'Point',coordinates:[4.8,52.3] }; },
    (input) => { input.geometry.features[0].properties = null; },
  ]) {
    const input = fixture(); mutate(input);
    await assert.rejects(load(input), /onverwacht formaat/);
  }
});

test('snapshot loader rejects unrenderable polygon coordinates before they reach a chart', async () => {
  for (const geometry of [
    { type:'Polygon',coordinates:[] },
    { type:'Polygon',coordinates:[[[4.8,52.3],[4.9,52.3],[null,52.4],[4.8,52.3]]] },
    { type:'Polygon',coordinates:[[[4.8,52.3],[4.9,52.3],['oops',52.4],[4.8,52.3]]] },
    { type:'Polygon',coordinates:[[[4.8,52.3],[4.9,52.3],[4.9,52.4],[4.8,52.4]]] },
    { type:'MultiPolygon',coordinates:[[]] },
  ]) {
    const input = fixture(); input.geometry.features[0].geometry = geometry;
    await assert.rejects(load(input), /onverwacht formaat/);
  }
});

test('an already cancelled load does not issue network requests', async () => {
  const controller = new AbortController(), calls = [];
  controller.abort();
  await assert.rejects(loadDevelopment(controller.signal, respond(fixture(),calls)), { name:'AbortError' });
  assert.equal(calls.length, 0);
});

test('cancellation while decoding a response cannot publish a successful snapshot', async () => {
  const controller = new AbortController(), input = fixture();
  const request = async (url) => ({ ok:true, json:async () => {
    controller.abort();
    return url.endsWith('-geometry.json') ? input.geometry : input.snapshot;
  } });
  await assert.rejects(loadDevelopment(controller.signal, request), { name:'AbortError' });
});
