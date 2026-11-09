import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import Papa from 'papaparse';
import { aggregate, association, countAssociation, classify, clusterStreets, clusterMetrics, createRoads, filterStreets, streetScope, metricDetail, streetCSV, metrics, pearson, ranks, roadCSV, roadGeoJSON, snapshot, observationMeta, summary, values, combineCounts, windowTotal } from '../src/features/streets/model.ts';
import { buildHeat, validateHeat, heatCount, heatReference, heatKinds, hexagons, hexAddress, hexReference } from '../src/features/streets/heat.ts';
import { shiftAnalysis, rankShifts, shiftsCSV, defaultShift } from '../src/features/streets/shifts.ts';
import { roadMatcher, pointSegmentDistance } from '../src/features/streets/spatial.ts';
const sourceText = readFileSync(new URL('../src/features/streets/roads.json', import.meta.url));
const source = JSON.parse(sourceText);
const observed = JSON.parse(readFileSync(new URL('../src/features/streets/observations.json', import.meta.url)));
const roads = createRoads(source, observed);
const raw = (extra = {}) => ({ lights: 10, known: 10, faults: 1, trees: 2, reports: Array(12).fill(12), nuisance: Array(12).fill(3), maintenance: Array(12).fill(2), ...extra });
const road = (id, length = 100, counts = raw(), extra = {}) => ({ id, name: 'Street', ward: 'A', kind: 'RB', length, group: 'Street', raw: counts, months: 12, ...values(counts, length, 12), geometry: { type: 'MultiLineString', coordinates: [[[4.9, 52.3], [4.91, 52.31]]] }, ...extra });
const street = (id, value, extra = {}) => ({ id, name: id, ...Object.fromEntries(metrics.map(m => [m, value])), count: 1, length: 100, ward: 'A', raw: raw(), months: 12, ...extra });
const f = { ward: null, query: '', status: 'all', cluster: null, doubleDeficit: false };
test('All unique source records reconcile; count snapshot matches exact geography and source audits', () => {
  assert.equal(roads.length, 45870); assert.equal(roads.length, snapshot.count);
  assert.equal(new Set(roads.map(r => r.id)).size, roads.length);
  assert.equal(createHash('sha256').update(sourceText).digest('hex'), observationMeta.geometrySha256);
  assert.equal(observationMeta.months.length, 12);
  const total = combineCounts(roads.map(r => r.raw));
  for (const s of observationMeta.sources) {
    assert.equal(s.total, s.matched + s.unmatched + s.ambiguous + s.invalid + s.excluded, s.key);
    assert.equal(s.sha256.length, 64);
    assert.equal(s.matched, s.key === 'lights' ? total.lights : s.key === 'trees' ? total.trees : windowTotal(total.reports, 12));
  }
  assert.ok(total.lights > 50000); assert.ok(total.trees > 100000); assert.ok(windowTotal(total.reports, 12) > 100000);
  assert.equal(observationMeta.sources.find(s => s.key === 'reports').minDate, observationMeta.reportStart);
  assert.ok(observationMeta.sources.find(s => s.key === 'reports').maxDate < observationMeta.reportEndExclusive);
  assert.ok(observationMeta.sources.find(s => s.key === 'lights').excluded > 0, 'Non-armature equipment is excluded');
});
test('Ratios use summed counts and their real denominators, including subthreshold segments', () => {
  const rows = [road('1', 100, raw({ known: 2, lights: 2, faults: 1 })), road('2', 900, raw({ known: 98, lights: 100, faults: 0 }))];
  assert.equal(rows[0].outages, null);
  const a = aggregate(rows)[0]; assert.equal(a.outages, 1); assert.equal(a.lightDensity, 10.2); assert.equal(a.treeDensity, .4);
  assert.equal(a.reports, 2.4); assert.equal(a.nuisance, .6);
  assert.equal(summary(rows, 'outages').average, 1);
  assert.equal(metricDetail(rows, 'outages').average, 1);
  assert.equal(metricDetail(rows, 'outages').count, 1);
  assert.equal(values(raw({ lights: 0, known: 0, faults: 0 }), 100, 12).outages, null);
  assert.equal(values(raw(), 0, 12).treeDensity, null);
});
test('Quarterly windows use exactly the last three complete months and normalize per month', () => {
  const c = raw({ reports: [90, 90, 90, 90, 90, 90, 90, 90, 90, 3, 6, 9] });
  assert.equal(values(c, 100, 3).reports, 6);
  assert.ok(Math.abs(values(c, 100, 12).reports - 69) < 1e-10);
  const quarterly = createRoads(source, observed, 3);
  assert.deepEqual(quarterly.map(r => r.raw.trees), roads.map(r => r.raw.trees));
  assert.ok(windowTotal(combineCounts(quarterly.map(r => r.raw)).reports, 3) <= windowTotal(combineCounts(roads.map(r => r.raw)).reports, 12));
});
test('Invalid or mismatched observation files fail; no synthetic or zero fallback', () => {
  assert.throws(() => createRoads(source, { ...observed, schema: 2 }), /passen niet/);
  assert.throws(() => createRoads(source, { ...observed, roads: {} }), /passen niet/);
  const altered = { ...observed, roads: { ...observed.roads, [source.features[0].properties.id]: raw({ faults: 1000 }) } };
  assert.throws(() => createRoads(source, altered), /Ongeldige/);
});
test('Map thresholds are metric-specific, directional and missing is explicit', () => {
  assert.deepEqual([classify(0, 'outages'), classify(2, 'outages'), classify(10, 'outages'), classify(null, 'outages')], ['good', 'medium', 'poor', 'missing']);
  assert.deepEqual([classify(0, 'treeDensity'), classify(1, 'treeDensity'), classify(4, 'treeDensity')], ['poor', 'medium', 'good']);
  assert.equal(classify(4, 'reports'), 'poor');
});
test('Each nearby point matches once; ambiguous DIFFERENT streets and distant points are rejected', () => {
  assert.equal(pointSegmentDistance([5, 5], [0, 0], [10, 0]), 5);
  assert.equal(pointSegmentDistance([15, 0], [0, 0], [10, 0]), 5);
  const feature = (id, name, y) => ({ type: 'Feature', properties: { id, name, kind: 'RB' }, geometry: { type: 'MultiLineString', coordinates: [[[4.9, y], [4.91, y]]] } });
  const match = roadMatcher([feature('1', 'A', 52.3), feature('2', 'B', 52.3002)]);
  assert.equal(match([4.905, 52.3001]).status, 'ambiguous');
  assert.equal(match([4.905, 52.30001]).id, '1');
  assert.equal(match([4.905, 52.301]).status, 'unmatched');
  assert.equal(match([null, null]).status, 'invalid');
  const same = roadMatcher([feature('1', 'A', 52.3), feature('2', 'A', 52.3002)]);
  assert.equal(same([4.905, 52.3001]).status, 'matched', 'Parallel lanes with same name are not duplicate observations');
});
test('Whole street filtering happens after pooling; exact ID query never cherry-picks segments', () => {
  const rows = [road('1', 100), road('2', 300, raw({ trees: 100 })), road('3', 100, raw(), { ward: 'B' })];
  const all = streetScope(rows, null), local = streetScope(rows, 'A');
  assert.equal(all.length, 1); assert.equal(all[0].count, 3); assert.equal(local[0].count, 2);
  assert.equal(all[0].treeDensity, 20.8);
  assert.equal(filterStreets(all, { ...f, query: '2' }, 'treeDensity', new Map())[0].count, 3);
  assert.equal(filterStreets(all, { ...f, status: 'good' }, 'treeDensity', new Map())[0].count, 3);
  assert.equal(filterStreets(all, { ...f, status: 'poor' }, 'treeDensity', new Map()).length, 0);
  assert.equal(filterStreets(all, { ...f, cluster: 1 }, 'treeDensity', new Map([['Street', 0]])).length, 0);
});
test('Pearson, tied ranks, Spearman, missing data and tiny/constant samples', () => {
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1); assert.equal(pearson([1, 2, 3], [6, 4, 2]), -1);
  assert.equal(pearson([1, 1, 1], [2, 3, 4]), null); assert.equal(pearson([1, 2], [2, 4]), null);
  assert.deepEqual(ranks([5, 5, 1, 9]), [2.5, 2.5, 1, 4]);
  const rows = [street('1', 10, { reports: 20 }), street('2', 20, { reports: 30 }), street('3', 30, { reports: 40 }), street('4', 50, { reports: null })];
  const result = association(rows, 'treeDensity', 'reports'); assert.equal(result.r, 1); assert.equal(result.n, 3); assert.equal(result.excluded, 1); assert.equal(result.intercept, 10);
  assert.equal(association([street('1', 1, { reports: 9 }), street('2', 2, { reports: 15 }), street('3', 3, { reports: 80 })], 'treeDensity', 'reports', 'spearman').r, 1);
});
test('Citywide profiles use log-scaled independent metrics and exclude very short streets', () => {
  const input = [street('a', 0), street('b', .1), street('c', 80), street('d', 82), street('e', 50, { length: 10 })];
  const result = clusterStreets(input, 2); assert.equal(result.excluded, 1); assert.equal(result.clusters.length, 2);
  assert.equal(result.assignments.get('a'), result.assignments.get('b')); assert.notEqual(result.assignments.get('a'), result.assignments.get('c'));
  assert.equal(result.clusters[0].centroid.length, clusterMetrics.length);
  assert.deepEqual(result, clusterStreets(input, 2)); assert.equal(clusterStreets([], 4).clusters.length, 0);
});
test('Overview retains all 45,870 segments; Van Baerlestraat is one trace; exports retain original geometry', () => {
  const streets = streetScope(roads, null); assert.equal(streets.length, 5783);
  assert.equal(streets.flatMap(s => s.roads).length, roads.length);
  assert.ok(streets.every(s => s.geometry.coordinates.length > 0));
  const s = streets.find(s => s.name === 'Van Baerlestraat'); assert.equal(s.count, 72); assert.equal(s.geometry.coordinates.length, 1);
  assert.ok(s.raw.trees > 0 && s.raw.lights > 0 && windowTotal(s.raw.reports, 12) > 0);
  const exported = roadGeoJSON(s.roads, new Map());
  assert.deepEqual(exported.features.map(f => f.geometry), source.features.filter(f => f.properties.name === s.name).map(f => f.geometry));
  assert.ok(exported.features.every(f => f.properties.datatype === 'observed_counts_derived_spatially'));
  const csv = Papa.parse(streetCSV([s], new Map()), { header: true }).data;
  assert.equal(+csv[0].bomen, s.raw.trees); assert.equal(+csv[0]['treeDensity (/100 m NWB)'], s.treeDensity);
  assert.equal(Papa.parse(roadCSV([road('1', 100, raw(), { name: '=1+1' })], new Map()), { header: true }).data[0].naam, "'=1+1");
});

const heatSource = JSON.parse(readFileSync(new URL('../src/features/streets/heat.json', import.meta.url)));
test('Heatmap grid preserves source counts, road attribution and all monthly subsets', () => {
  validateHeat(heatSource);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../src/features/streets/heat.json', import.meta.url))).digest('hex'), observationMeta.heatSha256);
  const scoped = [roads, roads.filter(r => r.name === 'Van Baerlestraat'), roads.filter(r => r.ward === '14011069')];
  for (const scope of scoped) for (const months of [3, 12]) for (const kind of heatKinds) {
    const expected = scope.reduce((s, r) => s + (kind === 'trees' ? r.raw.trees : kind === 'lights' ? r.raw.lights : kind === 'faults' ? r.raw.faults : windowTotal(r.raw[kind], months)), 0);
    const view = buildHeat(heatSource, scope, kind, months);
    assert.equal(view.total, expected, `${kind} ${months}m ${scope.length} roads`);
    assert.equal(view.data.features.reduce((s, f) => s + f.properties.count, 0), expected);
    assert.equal(new Set(view.data.features.map(f => f.properties.id)).size, view.cells);
  }
  assert.equal(buildHeat(heatSource, [], 'reports', 12).total, 0);
});
test('Heatmap validation rejects mismatched, corrupt or invented source grids', () => {
  assert.throws(() => validateHeat({ ...heatSource, countsSha256: 'wrong' }), /passen niet/);
  assert.throws(() => validateHeat({ ...heatSource, cells: [[0, 1, 1, 0, 0, 1, []]] }), /Ongeldig/);
  assert.throws(() => validateHeat({ ...heatSource, cells: [[0, 1, 1, 0, 0, 0, [12, 1, 0, 0]]] }), /Ongeldige/);
  const cell = [0, 0, 0, 7, 3, 1, [0, 10, 2, 1, 11, 4, 1, 2]];
  assert.equal(heatCount(cell, 'reports', 3), 4); assert.equal(heatCount(cell, 'reports', 12), 14);
  assert.equal(heatCount(cell, 'nuisance', 12), 3); assert.equal(heatCount(cell, 'trees', 3), 7);
  const ref = heatReference(heatSource, 'reports', 250);
  assert.ok(Number.isFinite(ref) && ref > 0);
  buildHeat(heatSource, scopedRoads(), 'reports', 3);
  assert.equal(heatReference(heatSource, 'reports', 250), ref, 'Street/period filtering never changes the citywide reference');
});
function scopedRoads() { return roads.filter(r => r.name === 'Van Baerlestraat'); }

test('Fixed hexagons conserve every category and window, with equal-area closed polygons', () => {
  for (const kind of heatKinds) {
    const points = buildHeat(heatSource, roads, kind, 12);
    for (const width of [100, 250, 500]) {
      const hex = hexagons(points, width);
      assert.equal(hex.data.features.reduce((s, f) => s + f.properties.count, 0), points.total);
      assert.equal(hex.polygons.features.reduce((s, f) => s + f.properties.count, 0), points.total);
      assert.equal(new Set(hex.polygons.features.map(f => f.id)).size, hex.cells);
      const f = hex.polygons.features[0], ring = f.geometry.coordinates[0];
      assert.equal(ring.length, 7); assert.deepEqual(ring[0], ring[6]);
      const xy = ring.map(([x, y]) => [(x - 4.9) * 67900, (y - 52.37) * 111200]);
      const area = Math.abs(xy.slice(0, -1).reduce((s, p, i) => s + p[0] * xy[i + 1][1] - xy[i + 1][0] * p[1], 0)) / 2;
      assert.ok(Math.abs(area - Math.sqrt(3) / 2 * width ** 2) < .001);
      assert.ok(Math.abs(Math.max(...xy.map(p => p[0])) - Math.min(...xy.map(p => p[0])) - width) < 1e-6);
    }
    const local = buildHeat(heatSource, scopedRoads(), kind, 3);
    assert.equal(hexagons(local, 250).total, local.total);
  }
  assert.equal(hexagons(buildHeat(heatSource, [], 'reports', 12), 250).cells, 0);
  assert.throws(() => hexagons(buildHeat(heatSource, [], 'reports', 12), 0), /breedte/);
});
test('Hexagon allocation contains each point and has a viewport-independent reference', () => {
  for (const width of [100, 250, 500]) for (const [x, y] of [[0, 0], [width, 0], [-319.7, 170], [1223, -723]]) {
    const {q, r} = hexAddress(x, y, width), size = width / Math.sqrt(3);
    const cx = width * (q + r / 2), cy = 1.5 * size * r;
    const vertices = Array.from({length:6}, (_, i) => [cx + size * Math.cos((60 * i - 30) * Math.PI / 180), cy + size * Math.sin((60 * i - 30) * Math.PI / 180)]);
    for (let i = 0; i < 6; i++) { const a=vertices[i],b=vertices[(i+1)%6]; assert.ok((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]) >= -1e-7); }
  }
  const reference = hexReference(heatSource, 'reports', 250);
  hexagons(buildHeat(heatSource, scopedRoads(), 'reports', 3), 250);
  assert.equal(hexReference(heatSource, 'reports', 250), reference);
  assert.ok(reference > 0);
});


test('Profiles never invent duplicate or empty clusters and remain stable under input reorder', () => {
  const same = clusterStreets([street('b', 1), street('a', 1), street('c', 1)], 6);
  assert.equal(same.clusters.length, 1); assert.equal(same.clusters[0].members, 3); assert.equal(same.explainedVariance, null); assert.equal(same.converged, true);
  const rows = [street('a', 0),street('b',1),street('c',10),street('d',20),street('e',30)];
  assert.deepEqual(clusterStreets(rows, 3), clusterStreets([...rows].reverse(), 3));
  const result = clusterStreets(rows, 3);
  assert.equal(result.clusters.reduce((s,c)=>s+c.members,0), rows.length); assert.ok(result.explainedVariance > 0 && result.explainedVariance <= 1);
});
test('Raw-count correlation uses the SAME complete sample and preserves the selected report period', () => {
  const rows = [street('a',1,{raw:raw({trees:1,reports:Array(12).fill(10)})}),street('b',2,{raw:raw({trees:2,reports:Array(12).fill(20)})}),street('c',3,{raw:raw({trees:3,reports:Array(12).fill(30)})}),street('missing',null)];
  assert.deepEqual(countAssociation(rows,'treeDensity','reports','pearson'),{r:1,n:3});
  assert.equal(countAssociation(rows,'outages','reports','pearson'),null);
  assert.equal(countAssociation(rows.map(r=>({...r,months:3})),'treeDensity','reports','spearman').r,1);
});
const series = (before, recent) => [...Array(9).fill(before),...Array(3).fill(recent)];
const shiftStreet = (id, before, recent, extra={}) => street(id,1,{raw:raw({reports:series(before,recent)}),...extra});
const cityFor = rows => combineCounts(rows.map(r=>r.raw));
test('Shift radar removes each street from its reference; hand-worked 9/3-month comparison and real zero declines', () => {
  const target=shiftStreet('target',10,30), rest=shiftStreet('rest',100,200), city=cityFor([target,rest]);
  const result=shiftAnalysis([target],city,'reports'); const row=result.rows[0];
  assert.equal(row.before,90);assert.equal(row.recent,90);assert.equal(row.expected,60);assert.equal(row.excess,30);assert.equal(row.relative,50);assert.equal(row.aboveMonths,3);assert.equal(result.eligible.length,1);
  assert.equal(row.expectedSeries.slice(0,9).reduce((s,n)=>s+n,0),90);
  const falling=shiftStreet('fall',10,0), stableRest=shiftStreet('rest',100,100);
  const fall=shiftAnalysis([falling],cityFor([falling,stableRest]),'reports').rows[0];
  assert.equal(fall.recent,0);assert.equal(fall.expected,30);assert.equal(fall.relative,-100);assert.equal(fall.reason,null);
});
test('Citywide common change cancels; fixed city reference survives search and period changes', () => {
  const a=shiftStreet('a',10,20),b=shiftStreet('b',100,200),city=cityFor([a,b]);
  const all=shiftAnalysis([a,b],city,'reports');
  assert.equal(all.rows[0].excess,0);assert.equal(all.rows[1].excess,0);
  assert.deepEqual(shiftAnalysis([{...a,months:3}],city,'reports').rows[0],all.rows[0]);
});
test('Small, short, zero-baseline and no-reference streets remain auditable without infinite percentages', () => {
  const zero=shiftStreet('zero',0,20),short=shiftStreet('short',10,20,{length:99}),tiny=shiftStreet('tiny',1,0),noRecent=shiftStreet('expected',10,0),rest=shiftStreet('rest',100,1);
  const result=shiftAnalysis([zero,short,tiny,noRecent],cityFor([zero,short,tiny,noRecent,rest]),'reports');
  assert.equal(result.rows[0].reason,'baseline');assert.equal(result.rows[0].relative,null);assert.equal(result.rows[1].reason,'short');assert.equal(result.rows[2].reason,'total');
  assert.equal(result.exclusions.reduce((s,e)=>s+e.count,0),result.excluded);
  const alone=shiftStreet('alone',10,20);assert.equal(shiftAnalysis([alone],cityFor([alone]),'reports').rows[0].reason,'reference');
  const sparse=shiftStreet('sparse',1,1), huge=shiftStreet('huge',100,100);assert.equal(shiftAnalysis([sparse],cityFor([sparse,huge]),'reports',10).rows[0].reason,'expected');
});
test('Radar ranking directions, subjects, CSV and real snapshot calculations stay consistent', () => {
  const a=shiftStreet('=a',10,30),b=shiftStreet('b',10,0),other=shiftStreet('other',100,100);const result=shiftAnalysis([a,b],cityFor([a,b,other]),'reports');
  assert.equal(rankShifts(result.rows,defaultShift)[0].id,'=a'); assert.equal(rankShifts(result.rows,{...defaultShift,direction:'down'})[0].id,'b');
  assert.equal(rankShifts(result.rows,{...defaultShift,direction:'all',sort:'relative'}).length,2);
  const csv=Papa.parse(shiftsCSV(result.rows,'reports'),{header:true}).data;
  assert.equal(csv[0].straat,"'=a");assert.equal(+csv[0].recent_3_maanden,90);assert.ok(csv[0].formule.includes('city_recent - street_recent'));
  const global=aggregate(roads),city=combineCounts(roads.map(r=>r.raw));
  for(const kind of ['reports','nuisance','maintenance']) {
    const analysis=shiftAnalysis(global,city,kind);
    assert.equal(analysis.eligible.length+analysis.excluded,global.length);
    assert.ok(analysis.eligible.length>10);
    assert.ok(analysis.rows.every(r=>[r.expected,r.excess,r.relative].every(v=>v===null||Number.isFinite(v))));
    const before=JSON.stringify(analysis.rows[0]);rankShifts(analysis.rows,{...defaultShift,kind});assert.equal(JSON.stringify(analysis.rows[0]),before);
  }
});

test('Kerkstraat and Herengracht in Weesp have separate identities from Amsterdam', () => {
  const groups = streetScope(roads, null);
  for (const name of ['Kerkstraat', 'Herengracht']) {
    const city = groups.find(row => row.name === name), weesp = groups.find(row => row.name === `${name} · Weesp`);
    assert.ok(city); assert.ok(weesp); assert.notEqual(city.id, weesp.id);
    assert.equal(weesp.roads.length, name === 'Kerkstraat' ? 3 : 7);
    assert.ok(!city.roads.some(road => weesp.roads.some(other => other.id === road.id)));
  }
});
