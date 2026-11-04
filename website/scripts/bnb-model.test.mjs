import assert from "node:assert/strict";
import { test } from "node:test";
import Papa from "papaparse";
import { booleanIntersects } from "@turf/boolean-intersects";
import { available, availabilityColor, cityStats, createBnbModel, wardStats, wardCSV, permitCSV, permitGeoJSON, visiblePermits, hoverPosition } from "../src/features/bnb/model.ts";

const model = createBnbModel();
const fixture = {
  ...model,
  wards: { type: "FeatureCollection", features: model.wards.features.slice(0, 2).map((w, i) => ({ ...w, properties: { ...w.properties, code: i ? "Y" : "X" } })) },
  quotas: { X: 5, Y: 10 },
  permits: [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `X-g-${i}`, ward: "X", status: "granted", guests: 2 })),
    ...[10, 30, 50].map((pendingDays, i) => ({ id: `X-p-${i}`, ward: "X", status: "pending", guests: 2, pendingDays })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `Y-g-${i}`, ward: "Y", status: "granted", guests: 2 })),
    { id: "Y-p-0", ward: "Y", status: "pending", guests: 2, pendingDays: 70 },
  ],
};
test("The example uses the reference map's 110 actual wards and contained, reproducible demo locations", () => {
  assert.equal(model.wards.features.length, 110);
  assert.deepEqual(model, createBnbModel());
  assert.equal(new Set(model.wards.features.map(w => w.properties.code)).size, 110);
  assert.equal(new Set(model.permits.map(p => p.id)).size, model.permits.length);
  const sourceCategories = model.wards.features.reduce((counts, w) => { counts[w.properties.sourceCategory] = (counts[w.properties.sourceCategory] ?? 0) + 1; return counts; }, {});
  assert.deepEqual(sourceCategories, { available: 68, unavailable: 22, limited: 20 });
  assert.ok(model.wards.features.some(w => w.properties.name === "Jordaan"));
  for (const ward of model.wards.features) {
    const permits = model.permits.filter(p => p.ward === ward.properties.code);
    assert.ok(permits.length > 0);
    assert.ok(booleanIntersects({ type: "Point", coordinates: ward.properties.anchor }, ward));
    for (const permit of permits) assert.ok(booleanIntersects({ type: "Point", coordinates: permit.coordinates }, ward), `${permit.id} lies in ${ward.properties.name}`);
  }
});
test("Pending applications do not consume current quota and cannot transfer to another ward", () => {
  const full = wardStats(fixture, "X"), spare = wardStats(fixture, "Y"), city = cityStats(fixture);
  assert.deepEqual([full.granted, full.pending, full.free, full.afterPending, full.excess], [5, 3, 0, 0, 3]);
  assert.deepEqual([spare.granted, spare.pending, spare.free, spare.afterPending], [4, 1, 6, 5]);
  assert.deepEqual([city.quota, city.granted, city.pending, city.free, city.afterPending, city.excess], [15, 9, 4, 6, 5, 3]);
  assert.notEqual(city.afterPending, Math.max(0, city.free - city.pending));
  assert.equal(city.averagePendingDays, 40); assert.equal(city.medianPendingDays, 40); assert.equal(full.medianPendingDays, 30); assert.equal(city.oldestPendingDays, 70); assert.equal(city.oldPending, 2);
  assert.equal(available(spare, "current"), 6); assert.equal(available(spare, "after-pending"), 5);
  assert.notEqual(availabilityColor(0), availabilityColor(6));
});
test("Location filters stay within a ward and do not alter capacity statistics", () => {
  const ward = model.wards.features.find(w => w.properties.name === "Jordaan"), code = ward.properties.code;
  const stats = wardStats(model, code);
  assert.equal(visiblePermits(model, null, "all", "").length, 0);
  assert.equal(visiblePermits(model, code, "all", "").length, stats.granted + stats.pending);
  assert.equal(visiblePermits(model, code, "pending", "").length, stats.pending);
  assert.deepEqual(wardStats(model, code), stats);
  const noQueue = model.wards.features.find(w => w.properties.name === "Havens-West");
  assert.equal(wardStats(model, noQueue.properties.code).averagePendingDays, null);
  assert.equal(wardStats(model, noQueue.properties.code).medianPendingDays, null);
});
test("CSV and GeoJSON keep the filtered records, ward identifier and explicit demo provenance", () => {
  const code = model.wards.features.find(w => w.properties.name === "Bellamybuurt").properties.code;
  const permits = visiblePermits(model, code, "pending", ""), csv = Papa.parse(permitCSV(permits), { header: true });
  assert.equal(csv.data.length, permits.length);
  assert.ok(csv.data.every(row => row.wijk_id === code && row.status === "In behandeling" && row.datatype === "fictief"));
  const geojson = permitGeoJSON(permits);
  assert.deepEqual(geojson.features[0].geometry.coordinates, permits[0].coordinates);
  assert.equal(geojson.features[0].properties.dataType, "fictief");
  assert.equal(geojson.features[0].properties.ward, code);
  assert.equal(Papa.parse(wardCSV(model), { header: true }).data.length, 110);
});
test("Following properties flip at edges, remain within the map, and can be pinned", () => {
  for (const [width, height, cardWidth, cardHeight] of [[900, 600, 244, 220], [360, 240, 244, 220], [180, 140, 160, 120]]) {
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [width / 2, height / 2]]) {
      for (const mode of ["follow", "fixed"]) {
        const position = hoverPosition({ x, y }, { width: cardWidth, height: cardHeight }, { width, height }, mode);
        assert.ok(position.left >= 8 && position.top >= 8);
        assert.ok(position.left + cardWidth <= width - 8 && position.top + cardHeight <= height - 8);
      }
    }
  }
  const card = { width: 244, height: 200 }, viewport = { width: 900, height: 600 };
  assert.deepEqual(hoverPosition({x: 1, y:1},card,viewport,"fixed"),{left:328,top:200});
  assert.deepEqual(hoverPosition({x: 800,y:500},card,viewport,"click"),{left:328,top:200});
  assert.notDeepEqual(hoverPosition({ x: 100, y: 100 }, card, viewport, "follow"), hoverPosition({ x: 150, y: 120 }, card, viewport, "follow"));
  assert.deepEqual(hoverPosition({ x: 100, y: 100 }, card, viewport, "fixed"), hoverPosition({ x: 150, y: 120 }, card, viewport, "fixed"));
});


test("City queue median pools individual applications rather than averaging ward medians; missing ages stay missing", () => {
  const custom = {...fixture, permits: [
    ...[1, 2, 3].map((pendingDays, i) => ({id: `X-${i}`,ward:"X",status:"pending",pendingDays,guests:2})),
    {id:"Y-1",ward:"Y",status:"pending",pendingDays:99,guests:2},
    {id:"Y-2",ward:"Y",status:"pending",pendingDays:null,guests:2},
  ]};
  assert.equal(cityStats(custom).medianPendingDays, 2.5);
  assert.equal(wardStats(custom, "Y").medianPendingDays, 99);
  assert.equal(wardStats(custom, "Y").averagePendingDays, 99);
});
