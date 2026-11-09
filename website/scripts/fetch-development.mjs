import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const origin = "https://api.data.amsterdam.nl";
const root = `${origin}/v1/statistieken/v2/`;
export const geometryVintage = "2022-03-24";
export const years = Array.from({ length: 15 }, (_, i) => 2012 + i);
export const fingerprint = (value) => createHash("sha256").update(value).digest("hex");

export function trustedPage(value, first) {
  const url = new URL(value);
  const initial = new URL(first);
  assert.equal(url.origin, origin, "Unexpected source host");
  assert.equal(url.pathname, initial.pathname, "Unexpected pagination path");
  assert.ok(!url.username && !url.password && !url.hash, "Unexpected URL credentials or fragment");
  for (const [key, item] of initial.searchParams) {
    if (key !== "page") assert.equal(url.searchParams.get(key), item, `Pagination changed ${key}`);
  }
  return url.href;
}

/** DSO HAL and GeoJSON use the same trusted host, but different pagination envelopes. */
export async function readPages(first, table, sources, request = fetch) {
  const records = [], visited = new Set();
  let next = first;
  let expectedTotal;
  while (next) {
    const url = trustedPage(next, first);
    assert.ok(!visited.has(url) && visited.size < 30, "Source pagination repeated or exceeded its limit");
    visited.add(url);
    const response = await request(url, { signal: AbortSignal.timeout(120000), redirect: "error" });
    assert.ok(response.ok, `Source returned ${response.status}: ${url}`);
    const text = await response.text();
    const data = JSON.parse(text);
    const rows = table === "features" ? data.features : data._embedded?.[table];
    assert.ok(Array.isArray(rows), `Missing ${table} in source response`);
    const advertisedTotal = data.page?.totalElements ?? data.numberMatched;
    if (advertisedTotal !== undefined) {
      assert.ok(Number.isSafeInteger(advertisedTotal) && advertisedTotal >= 0, "Invalid source total");
      if (expectedTotal !== undefined) assert.equal(advertisedTotal, expectedTotal, "Source total changed between pages");
      expectedTotal = advertisedTotal;
    }
    if (data.numberReturned !== undefined) assert.equal(data.numberReturned, rows.length, "Source page count differs from its records");
    const size = Number(new URL(url).searchParams.get("_pageSize"));
    const link = data._links?.next?.href;
    assert.ok(link || !size || rows.length < size, "Full final page has no continuation; completeness is uncertain");
    records.push(...rows);
    sources.push({ url, sha256: fingerprint(text), records: rows.length });
    next = link;
  }
  if (expectedTotal !== undefined) assert.equal(records.length, expectedTotal, "Source completeness differs from advertised total");
  return records;
}

export function positiveNumber(value, allowZero = false) {
  return typeof value === "number" && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) ? value : null;
}

export function makeSeries(records, indicatorId, areas) {
  const result = new Map();
  const seen = new Set();
  for (const row of records) {
    assert.equal(row.indicatorId, indicatorId, "Source indicator changed");
    assert.equal(row.gebiedDatum, geometryVintage, "Unexpected geography vintage");
    assert.ok(/^\d{4}$/.test(row.heeftBetrekkingOp), "Unexpected observation period");
    const year = Number(row.heeftBetrekkingOp);
    if (!years.includes(year)) continue;
    assert.equal(row.tijdType, "Peildatum", "Unexpected time type");
    assert.equal(row.begindatum, `${year}-01-01`, "Unexpected observation date");
    assert.equal(row.einddatum, row.begindatum, "Unexpected observation end date");
    let code;
    if (row.gebiedType === "Buurt") {
      if (row.gebiedCode === "ZZ99") continue;
      assert.ok(areas.has(row.gebiedCode), `Unknown neighborhood ${row.gebiedCode}`);
      code = `BU0363${row.gebiedCode}`;
    } else if (row.gebiedType === "Gemeente" && row.gebiedCode === "0363") code = "GM0363";
    else continue;
    const key = `${code}/${year}`;
    assert.ok(!seen.has(key), `Duplicate source observation ${key}`);
    seen.add(key);
    if (!result.has(code)) result.set(code, Object.fromEntries(years.map((y) => [y, null])));
    result.get(code)[year] = positiveNumber(row.waarde, indicatorId === 3031);
  }
  return result;
}

function definition(row, name, expectedUnit) {
  assert.equal(row.naam, name, "Source definition changed");
  assert.equal(row.statusVervallen, false, "Source indicator was retired");
  assert.equal(row.eenheidSymbool, expectedUnit, "Source unit changed");
  assert.equal(row.extraAttributen?.BBGA_peildatum, "1 januari", "Reference date changed");
  return {
    code: row.naam, id: row.id, label: row.labelKort, definition: row.definitie,
    description: row.beschrijving, unit: expectedUnit === "euro" ? "euro" : "woningen",
    source: row.bron, frequency: row.frequentie, referenceDate: "1 januari",
  };
}

export async function fetchDevelopment() {
  const sources = [];
  const [wozDefinitions, homeDefinitions, sourceAreas, geometry, wozRows, homeRows] = await Promise.all([
    readPages(`${root}indicatoren/?naam=WWOZ_GEM`, "indicatoren", sources),
    readPages(`${root}indicatoren/?naam=WVOORRBAG`, "indicatoren", sources),
    readPages(`${root}gebieden/?gebiedstype.id=7&_pageSize=1000`, "gebieden", sources),
    readPages(`${origin}/v1/gebieden/buurten/?_format=geojson&_pageSize=1000&geldigOp=${geometryVintage}`, "features", sources),
    readPages(`${root}cijfers/?indicator.id=3036&_pageSize=20000`, "cijfers", sources),
    readPages(`${root}cijfers/?indicator.id=3031&_pageSize=20000`, "cijfers", sources),
  ]);
  assert.equal(wozDefinitions.length, 1);
  assert.equal(homeDefinitions.length, 1);
  const definitions = {
    woz: definition(wozDefinitions[0], "WWOZ_GEM", "euro"),
    homes: definition(homeDefinitions[0], "WVOORRBAG", null),
  };
  assert.equal(definitions.woz.id, 3036);
  assert.equal(definitions.homes.id, 3031);
  assert.ok(sourceAreas.length > 500 && geometry.length > 500, "Unexpectedly incomplete neighborhood geography");
  const known = sourceAreas.filter((a) => a.code !== "ZZ99");
  const areaByCode = new Map(known.map((a) => [a.code, a]));
  const geometryBySourceId = new Map(geometry.map((f) => [f.id.replace(/^buurten\./, ""), f]));
  assert.equal(areaByCode.size, known.length, "Duplicate neighborhood codes");
  assert.equal(geometryBySourceId.size, geometry.length, "Duplicate geometry identifiers");
  assert.equal(known.length, geometry.length, "Geometry and statistical neighborhoods differ");
  const woz = makeSeries(wozRows, definitions.woz.id, areaByCode);
  const homes = makeSeries(homeRows, definitions.homes.id, areaByCode);
  const empty = () => Object.fromEntries(years.map((year) => [year, null]));
  const features = [];
  const areas = [...areaByCode.values()].sort((a, b) => a.code.localeCompare(b.code)).map((area) => {
    assert.equal(area.gebiedstypeId, 7);
    assert.equal(area.datum, geometryVintage);
    const feature = geometryBySourceId.get(area.bronId);
    assert.ok(feature, `Missing exact source geometry ${area.code}/${area.bronId}`);
    const p = feature.properties;
    const code = `BU0363${area.code}`;
    assert.equal(p.code, area.code);
    assert.equal(p.cbsCode, code);
    assert.equal(`${p.identificatie}.${p.volgnummer}`, area.bronId);
    assert.ok(p.beginGeldigheid.slice(0, 10) <= geometryVintage);
    assert.ok(!p.eindGeldigheid || p.eindGeldigheid.slice(0, 10) > geometryVintage);
    assert.ok(feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon");
    const rounded = JSON.parse(JSON.stringify(feature.geometry, (_, value) => typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value));
    features.push({ type: "Feature", id: code, geometry: rounded, properties: { code, name: area.naam, sourceId: area.bronId, geometryVintage } });
    return { code, name: area.naam, woz: woz.get(code) ?? empty(), homes: homes.get(code) ?? empty(), ...(code === "BU0363SA02" ? { breakYears: [2022, 2023] } : {}) };
  });
  const city = { code: "GM0363", name: "Amsterdam", woz: woz.get("GM0363"), homes: homes.get("GM0363"), breakYears: [2022, 2023] };
  for (const year of years) {
    assert.ok(city.woz?.[year] > 0 && city.homes?.[year] > 0, `Missing city observation ${year}`);
    assert.ok(areas.filter((a) => a.woz[year] > 0).length > 350, `Unexpectedly sparse WOZ ${year}`);
    assert.ok(areas.filter((a) => a.homes[year] !== null).length > 450, `Unexpectedly sparse housing stock ${year}`);
  }
  const geojson = { type: "FeatureCollection", features };
  const payload = { areas, city };
  const meta = {
    retrievedAt: new Date().toISOString(), years, geometryVintage,
    geography: "O&S/BBGA gebiedsindeling 24 maart 2022; exacte KRG-bronidentificatie en volgnummer, geen koppeling aan CBS 2025-grenzen.",
    definitions,
    valuationDates: Object.fromEntries(years.map((year) => [year, `${year - 1}-01-01`])),
    sources: sources.sort((a, b) => a.url.localeCompare(b.url)),
    sha256: fingerprint(JSON.stringify(payload)), geometrySha256: fingerprint(JSON.stringify(geojson)),
    method: "Gepubliceerde buurtgemiddelden en woningvoorraad uit de Statistiekhub. Historie waar mogelijk herberekend naar de gebiedsindeling 2022. Ontbrekende waarden blijven null. WOZ is euro per woning, geen prijs per m² of herhaalde-verkoopindex. De voorraadfilter signaleert veranderingen in woningmix, maar corrigeert die niet.",
    cityComparability: "Officiële stadsreeks Amsterdam (gebiedCode 0363, gebiedDatum 2022-03-24). O&S waarschuwt dat oudere cijfers niet altijd naar de nieuwe indeling konden worden herberekend, vooral Driemond en Amsterdam met/zonder Weesp. Wonen in cijfers bevestigt dat de voorraad op 1 januari 2023 (474.735 woningen) bijna 10.000 woningen extra door Weesp bevat. De indicator specificeert niet per jaar de Weesp-dekking. Daarom worden vergelijkingen over 2022 en 2023 conservatief onderbroken.",
    cityComparabilitySource: "https://onderzoek.amsterdam.nl/artikel/wonen-in-beeld",
    areaComparability: [{ code: "BU0363SA02", breakYears: [2022, 2023], reason: "O&S noemt Driemond expliciet als gebied waarvan de historische grenswijziging niet overal kon worden herberekend. De herindeling was in maart 2022, terwijl deze cijfers op 1 januari slaan. Vergelijkingen over 2022 en 2023 worden daarom conservatief onderbroken.", source: "https://onderzoek.amsterdam.nl/dataset/basisbestand-gebieden-amsterdam-bbga" }],
    comparabilitySource: "https://onderzoek.amsterdam.nl/dataset/basisbestand-gebieden-amsterdam-bbga",
    stockComparability: "De Engelstalige brondefinitie vermeldt dat de woningvoorraad vanaf 2015 ook relatief kleine huurwoningen, zoals studentenwoningen, omvat. Voorraadverandering kan daarom naast bouw en sloop ook een registratie-/definitie-effect bevatten.",
    coverage: { areas: areas.length, completeWoz: areas.filter((a) => years.every((y) => a.woz[y] !== null)).length },
  };
  const destination = resolve(import.meta.dirname, "../src/features/development");
  await mkdir(destination, { recursive: true });
  const output = { ...payload, meta };
  // Validate everything before touching either published artifact.
  await writeFile(`${destination}/snapshot.json.tmp`, `${JSON.stringify(output)}\n`);
  await writeFile(`${destination}/geometry.json.tmp`, `${JSON.stringify(geojson)}\n`);
  await rename(`${destination}/geometry.json.tmp`, `${destination}/geometry.json`);
  await rename(`${destination}/snapshot.json.tmp`, `${destination}/snapshot.json`);
  console.log(`Buurtontwikkeling: ${areas.length} neighborhoods, ${meta.coverage.completeWoz} complete WOZ series, ${years[0]}–${years.at(-1)}; ${sources.length} source pages.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await fetchDevelopment();
