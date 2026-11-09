import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fingerprint, makeSeries, positiveNumber, readPages, trustedPage } from "./fetch-development.mjs";

const first = "https://api.data.amsterdam.nl/v1/statistieken/v2/cijfers/?indicator.id=3036&_pageSize=2";
const record = (overrides = {}) => ({ indicatorId: 3036, gebiedDatum: "2022-03-24", gebiedType: "Buurt", gebiedCode: "AB03", tijdType: "Peildatum", begindatum: "2026-01-01", einddatum: "2026-01-01", heeftBetrekkingOp: "2026", waarde: 676184, ...overrides });
const areas = new Map([["AB03", {}]]);

test("pagination preserves source host, table and indicator", () => {
  assert.equal(trustedPage(`${first}&page=2`, first), `${first}&page=2`);
  for (const next of [first.replace("api.data.amsterdam.nl", "example.com"), first.replace("cijfers/", "indicatoren/"), first.replace("3036", "3031"), first.replace("https://", "https://user:pass@"), `${first}#fragment`]) assert.throws(() => trustedPage(next, first));
});

test("HAL pagination refuses a loop, a changed source and a full page without continuation", async () => {
  const response = (body) => ({ ok: true, text: async () => JSON.stringify(body) });
  await assert.rejects(readPages(first, "cijfers", [], async () => response({ _embedded: { cijfers: [{}, {}] } })), /completeness/);
  await assert.rejects(readPages(first, "cijfers", [], async () => response({ _embedded: { cijfers: [{}] }, _links: { next: { href: first } } })), /repeated/);
  await assert.rejects(readPages(first, "cijfers", [], async () => response({ _embedded: { cijfers: [{}] }, _links: { next: { href: first.replace("3036", "3031") } } })), /changed/);
  const sources = [];
  const rows = await readPages(first, "cijfers", sources, async () => response({ _embedded: { cijfers: [{}] } }));
  assert.equal(rows.length, 1);
  assert.match(sources[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(sources[0].records, 1);
});

test("pagination validates advertised totals and per-page record counts", async () => {
  const response = (body) => ({ ok: true, text: async () => JSON.stringify(body) });
  await assert.rejects(readPages(first, "cijfers", [], async () => response({ _embedded: { cijfers: [{}] }, page: { totalElements: 9813 } })), /completeness/);
  await assert.rejects(readPages(first, "cijfers", [], async () => response({ _embedded: { cijfers: [{}] }, numberReturned: 2 })), /page count/);
  const rows = await readPages(first, "cijfers", [], async (url) => response(url.includes("page=2")
    ? { _embedded: { cijfers: [{}] }, page: { totalElements: 3 } }
    : { _embedded: { cijfers: [{}, {}] }, page: { totalElements: 3 }, _links: { next: { href: `${first}&page=2` } } }));
  assert.equal(rows.length, 3);
});

test("suppression and missing values remain unknown; stock zero remains zero", () => {
  for (const value of [null, undefined, "0", -1, NaN, Infinity, 0]) assert.equal(positiveNumber(value), null);
  assert.equal(positiveNumber(0, true), 0);
  assert.equal(positiveNumber(676184), 676184);
  const series = makeSeries([record(), record({ heeftBetrekkingOp: "2025", begindatum: "2025-01-01", einddatum: "2025-01-01", waarde: null })], 3036, areas).get("BU0363AB03");
  assert.equal(series[2026], 676184);
  assert.equal(series[2025], null);
  assert.equal(series[2012], null);
});

test("series refuses duplicate observations, geography changes and unknown neighborhoods", () => {
  assert.throws(() => makeSeries([record(), record()], 3036, areas), /Duplicate/);
  assert.throws(() => makeSeries([record({ gebiedDatum: "2025-01-01" })], 3036, areas), /vintage/);
  assert.throws(() => makeSeries([record({ gebiedCode: "AB99" })], 3036, areas), /Unknown/);
  assert.throws(() => makeSeries([record({ indicatorId: 3031 })], 3036, areas), /indicator/);
  assert.throws(() => makeSeries([record({ begindatum: "2026-02-01" })], 3036, areas), /date/);
});

test("checked-in statistics and exact-vintage geometry retain matching identifiers and fingerprints", async () => {
  const directory = new URL("../src/features/development/", import.meta.url);
  const snapshot = JSON.parse(await readFile(new URL("snapshot.json", directory), "utf8"));
  const geometry = JSON.parse(await readFile(new URL("geometry.json", directory), "utf8"));
  assert.equal(snapshot.meta.sha256, fingerprint(JSON.stringify({ areas: snapshot.areas, city: snapshot.city })));
  assert.equal(snapshot.meta.geometrySha256, fingerprint(JSON.stringify(geometry)));
  assert.deepEqual(geometry.features.map((f) => f.id), snapshot.areas.map((a) => a.code));
  assert.ok(snapshot.areas.length > 500);
  assert.equal(new Set(geometry.features.map((f) => f.properties.sourceId)).size, geometry.features.length);
  assert.ok(geometry.features.every((f) => f.properties.geometryVintage === "2022-03-24"));
  assert.deepEqual(snapshot.city.breakYears, [2022, 2023]);
  assert.deepEqual(snapshot.areas.find((a) => a.code === "BU0363SA02").breakYears, [2022, 2023]);
  assert.equal(snapshot.meta.valuationDates[2026], "2025-01-01");
});
