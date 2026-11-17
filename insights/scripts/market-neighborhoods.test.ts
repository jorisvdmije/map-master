import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { makeDataset } from "../src/data/model.ts";
import { neighborhoodReport } from "../src/market/neighborhoods.ts";
const json = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../public/data/${name}`, import.meta.url), "utf8"),
  );
const base = makeDataset(
  json("amsterdam-development.json"),
  json("amsterdam-development-geometry.json"),
);
test("neighborhood model cannot use annual data beyond its explicit information cutoff", () => {
  const result = neighborhoodReport(base, "2021-12-31");
  assert.equal(result.year, 2020);
  assert.equal(result.availableAt, "2021-01-01");
  assert.ok(result.trainingYears.every((y) => y < result.year!));
  assert.ok(result.rows.length > 200);
  assert.ok(result.fitted);
  const changed = structuredClone(base);
  for (const area of changed.areas)
    for (const year of changed.years.filter((y) => y > 2020)) {
      area.woz[year] = 123456789;
      area.homes[year] = 987654;
    }
  assert.deepEqual(neighborhoodReport(changed, "2021-12-31"), result);
});
test("past-only neighborhood feature fitting does not change when held-out outcomes change", () => {
  const result = neighborhoodReport(base, "2021-12-31"),
    changed = structuredClone(base);
  const code = result.rows[0].code;
  changed.areas.find((a) => a.code === code)!.woz[2020]! *= 1.1;
  const next = neighborhoodReport(changed, "2021-12-31");
  assert.deepEqual(next.trainingYears, result.trainingYears);
  assert.equal(next.trainingCount, result.trainingCount);
  // Conditional benchmark can move, but each neighborhood adjustment stays trained on earlier years.
  const a = result.rows.find((r) => r.code === code)!,
    b = next.rows.find((r) => r.code === code)!;
  assert.ok(
    Math.abs(
      b.expectedGrowth -
        next.benchmarkGrowth! -
        (a.expectedGrowth - result.benchmarkGrowth!),
    ) < 1e-8,
  );
  assert.ok(Math.abs(a.residual - b.residual) > 1);
});
test("known boundary changes and material stock shifts are excluded from comparisons", () => {
  const result = neighborhoodReport(base, "2024-12-31");
  assert.ok(!result.rows.some((r) => r.code === "BU0363SA02"));
  assert.ok(
    result.rows.every((r) => r.homes >= 100 && Math.abs(r.stockGrowth) <= 20),
  );
  assert.ok(
    result.rows.every(
      (r) =>
        Number.isFinite(r.residual) &&
        Math.abs(r.actualGrowth - r.expectedGrowth - r.residual) < 1e-10,
    ),
  );
  assert.ok(result.excluded > 0);
});
test("before the annual dataset the map has no invented observations", () => {
  const result = neighborhoodReport(base, "2010-12-31");
  assert.equal(result.year, null);
  assert.deepEqual(result.rows, []);
  assert.equal(result.benchmarkGrowth, null);
  assert.throws(() => neighborhoodReport(base, "invalid"));
});
