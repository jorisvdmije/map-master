import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  type Area,
  type Dataset,
  type Workspace,
  VARIABLES,
  csvCell,
  exportCsv,
  formatValue,
  getValue,
  loadDataset,
  makeDataset,
  numericVariables,
  observations,
  pairedPoints,
  percentChange,
  regress,
  timeSeries,
} from "../src/data/model.ts";

const years = [2014, 2015, 2016, 2017];
const series = (values: (number | null)[]) =>
  Object.fromEntries(years.map((year, i) => [year, values[i]]));
const area = (
  code: string,
  values = [100, 110, 121, 133.1] as (number | null)[],
): Area => ({
  code,
  name: code,
  woz: series(values),
  homes: series([0, 10, 20, 30]),
});
const feature = (code: string) => ({
  type: "Feature",
  properties: { code, name: code },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [4, 52],
        [5, 52],
        [5, 53],
        [4, 52],
      ],
    ],
  },
});
const snapshot = (areas: Area[]) => ({
  areas,
  meta: {
    years,
    retrievedAt: "2026-11-09T12:00:00.000Z",
    geometryVintage: "2022-03-24",
  },
});
const fixture = (areas: Area[] = [area("A"), area("B"), area("C")]): Dataset =>
  makeDataset(snapshot(areas), {
    type: "FeatureCollection",
    features: areas.map((a) => feature(a.code)),
  });
const workspace: Workspace = {
  version: 1,
  name: "Amsterdam",
  start: 2014,
  end: 2017,
  year: 2017,
  selectionOnly: true,
  selected: ["A"],
  blocks: [
    {
      id: "one",
      title: "Data",
      kind: "table",
      x: "year",
      y: "woz",
      wide: false,
    },
  ],
};

test("official data retain all 518 exact-code neighborhoods and all 15 source years", async () => {
  const s = JSON.parse(
    await readFile(
      new URL("../public/data/amsterdam-development.json", import.meta.url),
      "utf8",
    ),
  );
  const g = JSON.parse(
    await readFile(
      new URL(
        "../public/data/amsterdam-development-geometry.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const data = makeDataset(s, g);
  assert.equal(data.areas.length, 518);
  assert.deepEqual(
    data.years,
    Array.from({ length: 15 }, (_, i) => 2012 + i),
  );
  assert.equal(getValue(data, "BU0363AA01", 2026, "woz"), 406560);
  assert.equal(data.meta.geometryVintage, "2022-03-24");
  assert.equal(observations(data).length, 518 * 15);
  assert.equal(data.geometry.features.length, data.areas.length);
});

test("missing stays unknown while a published housing count of zero is kept", () => {
  const data = fixture([area("A", [null, 110, 121, 133.1])]);
  assert.equal(getValue(data, "A", 2014, "woz"), null);
  assert.equal(getValue(data, "A", 2014, "homes"), 0);
  assert.equal(getValue(data, "A", 2015, "wozGrowth"), null);
  assert.equal(getValue(data, "not-there", 2015, "woz"), null);
  assert.equal(getValue(data, "A", 1999, "woz"), null);
  assert.equal(getValue(data, "A", 2014, "not-there"), null);
});

test("growth respects source boundary and 2015 housing-definition breaks", () => {
  const a = area("A");
  a.breakYears = [2016];
  const data = fixture([a]);
  assert.equal(getValue(data, "A", 2016, "wozGrowth"), null);
  assert.equal(getValue(data, "A", 2015, "homesGrowth"), null);
  assert.ok(Math.abs(getValue(data, "A", 2017, "wozGrowth")! - 10) < 1e-10);
  assert.equal(timeSeries(data, "A", "woz", 2014, 2017)[2].value, null);
  assert.equal(timeSeries(data, "A", "woz", 2014, 2017)[2].raw, 121);
  assert.deepEqual(
    timeSeries(data, "A", "woz", 2014, 2017, "index").map((p) => p.value),
    [100, 110, null, null],
  );
  assert.equal(
    timeSeries(data, "A", "woz", 2014, 2017, "growth")[0].value,
    null,
  );
  assert.deepEqual(timeSeries(data, "A", "woz", 2017, 2014), []);
});

test("WOZ per dwelling never becomes an invented square-meter price", () => {
  const data = fixture();
  assert.equal(VARIABLES.find((v) => v.id === "priceM2")?.available, false);
  assert.equal(
    numericVariables(data).some((v) => v.id === "priceM2"),
    false,
  );
  assert.equal(getValue(data, "A", 2016, "priceM2"), null);
  data.areas[0].series = { priceM2: series([4000, 4500, 5000, 5500]) };
  assert.equal(getValue(data, "A", 2016, "priceM2"), 5000);
  assert.equal(formatValue(5000, "€/m²"), "€ 5.000/m²");
});

test("paired cross-section excludes incomplete pairs and honors an empty selection", () => {
  const a = area("A");
  a.homes["2017"] = null;
  const data = fixture([a, area("B"), area("C")]);
  assert.equal(pairedPoints(data, 2017, "homes", "woz").length, 2);
  assert.deepEqual(pairedPoints(data, 2017, "homes", "woz", []), []);
  assert.deepEqual(
    pairedPoints(data, 2017, "homes", "woz", ["C"]).map((p) => p.code),
    ["C"],
  );
  assert.equal(pairedPoints(data, 2017, "homes", "woz")[0].y, 133.1);
});

test("centered OLS recovers known coefficients and excludes nonfinite pairs", () => {
  const points = [1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 3 }));
  const result = regress([...points, { x: NaN, y: 1 }, { x: 1, y: Infinity }])!;
  assert.equal(result.n, 4);
  assert.equal(result.slope, 2);
  assert.equal(result.intercept, 3);
  assert.equal(result.r2, 1);
  assert.equal(result.correlation, 1);
  assert.deepEqual(result.residuals, [0, 0, 0, 0]);
  assert.equal(
    regress([1, 2, 3].map((x) => ({ x, y: -2 * x })))?.correlation,
    -1,
  );
});

test("regression rejects too few pairs and constant x, keeps undefined constant-y R²", () => {
  assert.equal(
    regress([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]),
    null,
  );
  assert.equal(regress([1, 2, 3].map((y) => ({ x: 1, y }))), null);
  const constant = regress([1, 2, 3].map((x) => ({ x, y: 5 })))!;
  assert.equal(constant.slope, 0);
  assert.equal(constant.intercept, 5);
  assert.equal(constant.r2, null);
});

test("percentage changes never divide by zero or a suppressed negative baseline", () => {
  assert.equal(percentChange(0, 2), null);
  assert.equal(percentChange(null, 2), null);
  assert.equal(percentChange(-1, 2), null);
  assert.equal(percentChange(Infinity, 2), null);
  assert.equal(percentChange(100, 0), -100);
});

test("CSV exports selected period and neighborhoods, source vintage and safe text", () => {
  const data = fixture();
  data.areas[0].name = '=HYPERLINK("test")';
  const csv = exportCsv(data, workspace);
  assert.equal(csv.split("\r\n").length, 5);
  assert.ok(csv.includes("2022-03-24"));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(!csv.includes('"B"'));
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(-1), '"-1"');
  assert.equal(csvCell("+cmd"), '"\'+cmd"');
  assert.equal(csvCell('a"b'), '"a""b"');
});

test("source validation rejects duplicate codes, wrong year coverage and invalid geometry", () => {
  assert.throws(() => fixture([area("A"), area("A")]));
  const s = snapshot([area("A")]);
  s.meta.years = [2014, 2016];
  assert.throws(() =>
    makeDataset(s, { type: "FeatureCollection", features: [feature("A")] }),
  );
  const a = area("A");
  a.woz["2015"] = NaN;
  assert.throws(() => fixture([a]));
  assert.throws(() =>
    makeDataset(snapshot([area("A")]), {
      type: "FeatureCollection",
      features: [],
    }),
  );
  const bad = feature("A");
  bad.geometry.coordinates[0][0][0] = 190;
  assert.throws(() =>
    makeDataset(snapshot([area("A")]), {
      type: "FeatureCollection",
      features: [bad],
    }),
  );
});

test("load failures and cancellation do not silently produce empty data", async () => {
  const request = (async () =>
    new Response("", { status: 503 })) as typeof fetch;
  await assert.rejects(loadDataset(undefined, request), /niet worden geladen/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadDataset(controller.signal, (async () => {
      controller.signal.throwIfAborted();
      return new Response();
    }) as typeof fetch),
    { name: "AbortError" },
  );
});
