import assert from "node:assert/strict";
import { test } from "node:test";
import Papa from "papaparse";
import { parseGeoJSON, parseCSV, csvDataset, spatialRows, filterRows, summarize, histogram, categories, exportCSV, areaKm2, emptyFilters, demoDataset, demoArea } from "../src/features/analysis/model.ts";

const point = (x, y, properties = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [x, y] }, properties });
const polygon = rings => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: rings } });
const collection = features => ({ type: "FeatureCollection", features });
const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const hole = [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]];

test("The fictitious demo is reproducible and gives the guided area a meaningful mix of requests", () => {
  const sample = demoDataset();
  assert.deepEqual(sample, demoDataset(), "The same reports and results return on reload");
  assert.equal(sample.data.features.length, 144);
  assert.deepEqual(parseGeoJSON(sample.data, sample.name), sample);
  assert.equal(new Set(sample.data.features.map(f => JSON.stringify(f.geometry.coordinates))).size, 144);
  const rows = spatialRows(sample, demoArea);
  assert.ok(rows.length > 20 && rows.length < sample.data.features.length);
  const mix = categories(rows.map(i => sample.data.features[i]), "category");
  assert.equal(mix[0].label, "Waste", "The guided example highlights a waste-report concentration");
  assert.ok(mix.length > 1 && mix[0].count > mix.at(-1).count);
  const stats = summarize(sample.data.features, "cost");
  assert.ok(stats.missing > 0 && stats.valid > 0, "Some reports have no estimate, which the guide explains");
  assert.ok(stats.max > stats.average * 2, "Repair estimates have a varied, asymmetric distribution");
});

test("Spatial joins include boundaries, exclude holes, and count multipart objects once", () => {
  const data = parseGeoJSON(collection([
    point(2, 2), point(0, 5), point(5, 5), point(20, 20),
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-1, 2], [11, 2]] } },
    polygon([[[9, 9], [12, 9], [12, 12], [9, 12], [9, 9]]]),
    { type: "Feature", properties: {}, geometry: { type: "MultiPoint", coordinates: [[1, 1], [2, 2], [20, 20]] } },
  ]), "spatial");
  assert.deepEqual(spatialRows(data, polygon([ring, hole])), [0, 1, 4, 5, 6]);
  assert.equal(spatialRows(data, null).length, 7);
  assert.ok(areaKm2(polygon([ring, hole])) < areaKm2(polygon([ring])));
});

test("CSV handles BOM, quoted delimiters, newlines, semicolons and coordinate mapping", () => {
  const input = parseCSV('\uFEFFname;east;north;cost;code\r\n"A; B";4.9;52.37;12;001\r\n"two\nlines";4.91;52.38;;002');
  const dataset = csvDataset(input, "east", "north", "csv");
  assert.equal(dataset.data.features[0].properties.name, "A; B");
  assert.equal(dataset.data.features[1].properties.name, "two\nlines");
  assert.equal(dataset.data.features[1].properties.cost, null);
  assert.equal(dataset.data.features[0].properties.code, "001");
  assert.deepEqual(dataset.data.features[0].geometry.coordinates, [4.9, 52.37]);
  assert.throws(() => csvDataset(input, "east", "east", "bad"), /different/);
});

test("Bad imports fail as a whole: missing coordinates, duplicate headers, bad rows and unsupported geometry", () => {
  assert.throws(() => csvDataset(parseCSV("lon,lat\n,52"), "lon", "lat", "bad"), /row 2/);
  assert.throws(() => csvDataset(parseCSV("lon,lat\n181,52"), "lon", "lat", "bad"), /Feature 1/);
  assert.throws(() => parseCSV("lon,lon\n1,2"), /unique/);
  assert.throws(() => parseCSV("lon,lat\n1,2,3"), /consistent/);
  assert.throws(() => parseGeoJSON(collection([point(2, 2), { type: "Feature", properties: {}, geometry: null }]), "bad"), /Feature 2/);
  assert.throws(() => parseGeoJSON(polygon([ring.slice(0, -1)]), "bad"), /closed/);
});

test("Linked filters combine space, category, query and range; missing values do not become zeros", () => {
  const data = parseGeoJSON(collection([point(1, 1, { category: "A", cost: 0, name: "alpha" }), point(2, 2, { category: "A", cost: 10, name: "beta" }), point(3, 3, { category: "B", cost: null }), point(4, 4, { category: "B", cost: "25" })]), "numbers");
  const fields = { category: "category", metric: "cost", size: false };
  const rows = spatialRows(data, null);
  assert.deepEqual(filterRows(data, rows, fields, { category: "string:A", query: "ALPHA", range: [0, 5] }), [0]);
  assert.deepEqual(summarize(data.data.features, "cost"), { count: 4, valid: 2, missing: 2, sum: 10, average: 5, min: 0, max: 10, median: 5, q1: 2.5, q3: 7.5 });
  assert.equal(summarize([], "cost").sum, null);
  assert.equal(filterRows(data, rows, fields, emptyFilters).length, 4);
  assert.equal(histogram(data.data.features, "cost").reduce((s, b) => s + b.count, 0), 2);
  assert.equal(histogram([data.data.features[0]], "cost")[0].count, 1);
});

test("Category identity distinguishes typed values and missing; export preserves properties and geometry", () => {
  const data = parseGeoJSON(collection([point(1, 1, { category: 1 }), point(2, 2, { category: "1" }), point(3, 3, { category: null }), point(4, 4, { category: "=SUM(A1)", nested: { ok: true } })]), "export");
  assert.equal(categories(data.data.features, "category").length, 4);
  const csv = Papa.parse(exportCSV(data.data.features), { header: true });
  assert.equal(csv.data[3].category, "'=SUM(A1)");
  assert.equal(csv.data[3].nested, '{"ok":true}');
  assert.equal(csv.data[0].longitude, "1");
  assert.equal(csv.data[0].latitude, "1");
  assert.deepEqual(JSON.parse(csv.data[0].geometry_geojson), data.data.features[0].geometry);
  const collision = parseGeoJSON(point(1, 1, { feature_id: "own id", geometry_geojson: "own geometry" }), "collision");
  const collisionCsv = Papa.parse(exportCSV(collision.data.features), { header: true });
  assert.equal(collisionCsv.data[0].feature_id, "own id");
  assert.equal(collisionCsv.data[0].geometry_geojson, "own geometry");
  assert.deepEqual(JSON.parse(collisionCsv.data[0]._geometry_geojson), collision.data.features[0].geometry);
});


test("Histogram selections conserve exact boundary values across negative and decimal bins", () => {
  for (const numbers of [[-3, -2, -1, 0, 1, 2, 3], [0, .1, .2, .3, .4, .5, .6], [7, 7, 7]]) {
    const dataset = parseGeoJSON(collection(numbers.map(cost => point(1, 1, {cost}))), "bounds");
    const rows = spatialRows(dataset, null), bins = histogram(dataset.data.features, "cost");
    const selected = bins.map(bin => filterRows(dataset, rows, {metric:"cost",category:"",size:false}, {...emptyFilters, range:[bin.min,bin.max],rangeExclusive:bin.exclusive}));
    assert.deepEqual(selected.map(rows => rows.length), bins.map(bin => bin.count));
    assert.deepEqual(selected.flat().sort((a,b)=>a-b), rows, "Each exact value belongs to exactly one selectable bin");
  }
});
test("Median and interpolated quartiles describe skew without treating missing values as zero", () => {
  const stats = summarize([0, 10, 20, 1000, null, "5"].map(cost => point(1, 1, {cost})), "cost");
  assert.equal(stats.median, 15); assert.equal(stats.q1, 7.5); assert.equal(stats.q3, 265); assert.equal(stats.average, 257.5);
  assert.equal(summarize([], "cost").median, null);
});
