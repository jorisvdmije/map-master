import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getValue, makeDataset, type Dataset } from "../src/data/model.ts";
import {
  sourceCatalog,
  getSource,
  STATISTICS_ROOT,
  type SourceDefinition,
} from "../src/data/catalog.ts";
import {
  fetchSourceLive,
  fingerprint,
  loadSource,
  mergeSource,
  normalizeSourceRows,
  readSourcePages,
  removeSource,
  trustedPage,
  validateSourceBundle,
  type SourceBundle,
} from "../src/data/source-loader.ts";

const source = getSource("population")!;
const knownCodes = ["BU0363AA01", "BU0363AA02"];
async function saved(id = source.id): Promise<SourceBundle> {
  return JSON.parse(
    await readFile(
      new URL(`../public/data/catalog/${id}.json`, import.meta.url),
      "utf8",
    ),
  );
}
async function base(): Promise<Dataset> {
  return makeDataset(
    JSON.parse(
      await readFile(
        new URL("../public/data/amsterdam-development.json", import.meta.url),
        "utf8",
      ),
    ),
    JSON.parse(
      await readFile(
        new URL(
          "../public/data/amsterdam-development-geometry.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
}
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function row(
  id: number,
  value: unknown = 20,
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  // Artificial records are fixtures for validation tests only, not shipped observations.
  return {
    indicatorId: id,
    gebiedType: "Buurt",
    gebiedDatum: "2022-03-24",
    gebiedCode: "AA01",
    heeftBetrekkingOp: "2026",
    tijdType: "Peildatum",
    begindatum: "2026-01-01",
    einddatum: "2026-01-01",
    waarde: value,
    ...changes,
  };
}
function liveRequest(
  def: SourceDefinition,
  changeMetadata = false,
): typeof fetch {
  return (async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/indicatoren/")) {
      const indicator = def.indicators.find(
        (candidate) => candidate.code === url.searchParams.get("naam"),
      )!;
      return response({
        _embedded: {
          indicatoren: [
            {
              id: indicator.id,
              naam: indicator.code,
              statusVervallen: false,
              eenheidSymbool: changeMetadata ? "wrong" : indicator.unit,
              extraAttributen: { BBGA_peildatum: indicator.metadataReference },
              label: "Synthetic test indicator",
              definitie: "Synthetic validation fixture only",
              bron: ["Test fixture"],
            },
          ],
        },
      });
    }
    const id = Number(url.searchParams.get("indicator.id"));
    return response({ _embedded: { cijfers: [row(id)] } });
  }) as typeof fetch;
}

test("catalog provides six domains with distinct original sources and no observations in metadata", () => {
  assert.equal(sourceCatalog.length, 6);
  assert.equal(
    new Set(
      sourceCatalog.flatMap((entry) =>
        entry.variables.map((variable) => variable.id),
      ),
    ).size,
    12,
  );
  assert.ok(
    sourceCatalog.every(
      (entry) => entry.publisher === "Onderzoek en Statistiek Amsterdam",
    ),
  );
  assert.ok(getSource("income")!.upstreamSources.includes("CBS"));
  assert.ok(getSource("energy")!.upstreamSources.includes("RVO"));
  assert.ok(getSource("environment")!.upstreamSources.includes("BGT"));
  assert.equal(getSource("__proto__"), undefined);
  assert.equal(getSource("energy")!.years.includes(2020), false);
  assert.equal(getSource("income")!.years.at(-1), 2024);
  assert.equal(getSource("environment")!.years.at(-1), 2025);
  assert.ok(
    !JSON.stringify(sourceCatalog).includes('population_total":{"2012"'),
  );
});

test("all committed snapshots validate, hash correctly and match all 518 exact map codes", async () => {
  const data = await base();
  for (const definition of sourceCatalog) {
    const bundle = validateSourceBundle(await saved(definition.id), definition);
    assert.equal(bundle.areas.length, 518);
    assert.deepEqual(
      bundle.areas.map((area) => area.code),
      data.areas.map((area) => area.code).sort(),
    );
    const payload = {
      sourceId: bundle.sourceId,
      geometryVintage: bundle.geometryVintage,
      years: bundle.years,
      areas: bundle.areas,
    };
    assert.equal(await fingerprint(JSON.stringify(payload)), bundle.sha256);
    assert.ok(bundle.provenance.length >= definition.indicators.length * 2);
    for (const year of definition.years)
      assert.ok(
        bundle.areas.some((area) =>
          Object.values(area.series).some((series) => series[year] !== null),
        ),
      );
    const merged = mergeSource(data, bundle);
    for (const variable of definition.variables) {
      assert.equal(
        merged.variables.find((candidate) => candidate.id === variable.id)
          ?.sourceId,
        definition.id,
      );
      assert.deepEqual(
        merged.variables.find((candidate) => candidate.id === variable.id)
          ?.years,
        definition.years,
      );
    }
  }
});

test("real observations retain source-specific coverage and unknown cells", async () => {
  let data = await base();
  for (const definition of sourceCatalog)
    data = mergeSource(data, await saved(definition.id));
  assert.equal(getValue(data, "BU0363AA01", 2026, "population_total"), 338);
  assert.equal(
    getValue(data, "BU0363AA01", 2026, "households_single_pct"),
    73.3,
  );
  assert.equal(getValue(data, "BU0363AA01", 2024, "income_mean"), 40762);
  assert.equal(getValue(data, "BU0363AA01", 2026, "income_mean"), null);
  assert.equal(
    getValue(data, "BU0363AA01", 2024, "income_low_quintile_pct"),
    null,
  );
  assert.equal(getValue(data, "BU0363AA01", 2020, "energy_good_pct"), null);
  assert.equal(getValue(data, "BU0363AA01", 2026, "energy_good_pct"), 18.5);
  assert.equal(
    getValue(data, "BU0363AA01", 2025, "environment_green_pct"),
    0.02,
  );
  assert.equal(
    getValue(data, "BU0363AA01", 2026, "environment_green_pct"),
    null,
  );
});

test("lazy snapshot mode fetches only its selected local source", async () => {
  const paths: string[] = [];
  const input = await saved("income");
  const request = (async (url) => {
    paths.push(String(url));
    return response(input);
  }) as typeof fetch;
  const bundle = await loadSource(getSource("income")!, {
    mode: "snapshot",
    request,
  });
  assert.deepEqual(paths, ["/data/catalog/income.json"]);
  assert.equal(bundle.loadedFrom, "snapshot");
  assert.equal(bundle.fallbackReason, undefined);
});

test("live loading validates metadata and observations and retains provenance hashes", async () => {
  const bundle = await fetchSourceLive(source, {
    request: liveRequest(source),
    knownCodes,
  });
  assert.equal(bundle.loadedFrom, "live");
  assert.equal(bundle.areas.length, 2);
  assert.equal(bundle.areas[0].series.population_total[2026], 20);
  assert.equal(bundle.areas[1].series.population_total[2026], null);
  assert.equal(bundle.provenance.length, 6);
  assert.ok(
    bundle.provenance.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)),
  );
  assert.ok(
    bundle.definitions.every((definition) =>
      definition.recordReference.includes("bronjaar"),
    ),
  );
});

test("failed live requests return dated snapshot and explicit reason", async () => {
  const input = await saved();
  const paths: string[] = [];
  const request = (async (url) => {
    paths.push(String(url));
    if (String(url).startsWith("https:"))
      return response({ error: "offline" }, 503);
    return response(input);
  }) as typeof fetch;
  const result = await loadSource(source, { request, knownCodes });
  assert.equal(result.loadedFrom, "snapshot");
  assert.equal(result.retrievedAt, input.retrievedAt);
  assert.match(result.fallbackReason!, /503/);
  assert.ok(paths.includes("/data/catalog/population.json"));
});

test("caller cancellation never falls back to a snapshot", async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  const request = (async () => {
    requests++;
    throw new Error("must not fetch");
  }) as typeof fetch;
  await assert.rejects(
    loadSource(source, { signal: controller.signal, request, knownCodes }),
    { name: "AbortError" },
  );
  assert.equal(requests, 0);
});

test("metadata-unit drift is rejected instead of silently merging a renamed quantity", async () => {
  await assert.rejects(
    fetchSourceLive(source, { request: liveRequest(source, true), knownCodes }),
    /indicatordefinitie/,
  );
});

test("snapshot checksum rejects a changed observation before it can be loaded", async () => {
  const input = await saved();
  input.areas[0].series.population_total[2026] = 123456;
  await assert.rejects(
    loadSource(source, {
      mode: "snapshot",
      request: (async () => response(input)) as typeof fetch,
    }),
    /controlewaarde/,
  );
});

test("pagination follows a constrained continuation and validates total record count", async () => {
  const first = `${STATISTICS_ROOT}cijfers/?indicator.id=2267&_pageSize=2`;
  const next = `${first}&page=2`;
  const provenance: { url: string; sha256: string; records: number }[] = [];
  const request = (async (url) =>
    response({
      _embedded: {
        cijfers: String(url) === first ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }],
      },
      page: { totalElements: 3 },
      _links: String(url) === first ? { next: { href: next } } : {},
    })) as typeof fetch;
  assert.equal(
    (await readSourcePages(first, "cijfers", provenance, { request })).length,
    3,
  );
  assert.equal(provenance.length, 2);
});

test("pagination rejects hostile hosts, table changes, extra/duplicate filters and loops", async () => {
  const first = `${STATISTICS_ROOT}cijfers/?indicator.id=2267&_pageSize=2`;
  for (const url of [
    first.replace("api.data.amsterdam.nl", "example.com"),
    first.replace("/cijfers/", "/indicatoren/"),
    first.replace("2267", "3036"),
    `${first}&indicator.id=3036`,
    `${first}&filter=else`,
    `${first}&page=0`,
    first.replace("https://", "https://user:pass@"),
    `${first}#fragment`,
  ])
    assert.throws(() => trustedPage(url, first));
  const request = (async () =>
    response({
      _embedded: { cijfers: [{ id: 1 }] },
      _links: { next: { href: first } },
    })) as typeof fetch;
  await assert.rejects(
    readSourcePages(first, "cijfers", [], { request }),
    /herhaalde/,
  );
});

test("pagination refuses a full final page without continuation and a false advertised total", async () => {
  const first = `${STATISTICS_ROOT}cijfers/?indicator.id=2267&_pageSize=2`;
  await assert.rejects(
    readSourcePages(first, "cijfers", [], {
      request: (async () =>
        response({
          _embedded: { cijfers: [{ id: 1 }, { id: 2 }] },
        })) as typeof fetch,
    }),
    /vervolglink/,
  );
  await assert.rejects(
    readSourcePages(first, "cijfers", [], {
      request: (async () =>
        response({
          _embedded: { cijfers: [{ id: 1 }] },
          page: { totalElements: 3 },
        })) as typeof fetch,
    }),
    /minder records/,
  );
});

test("normalization preserves zero, converts suppressed negative to null and never fills gaps", () => {
  const indicator = source.indicators[0];
  const result = normalizeSourceRows(
    [row(indicator.id, 0), row(indicator.id, -99999, { gebiedCode: "AA02" })],
    indicator,
    source,
    knownCodes,
  );
  assert.equal(result.get(knownCodes[0])![2026], 0);
  assert.equal(result.get(knownCodes[0])![2025], null);
  assert.equal(result.get(knownCodes[1])![2026], null);
});

test("normalization rejects bad vintage, unknown area, duplicates, wrong indicator and temporal drift", () => {
  const indicator = source.indicators[0];
  for (const changes of [
    { gebiedDatum: "2025-01-01" },
    { gebiedCode: "ZZ01" },
    { indicatorId: 3036 },
    { heeftBetrekkingOp: "2025/2026" },
    { tijdType: "Jaar" },
    { begindatum: "2026-12-31" },
    { einddatum: "2026-12-31" },
  ])
    assert.throws(() =>
      normalizeSourceRows(
        [row(indicator.id, 10, changes)],
        indicator,
        source,
        knownCodes,
      ),
    );
  assert.throws(() =>
    normalizeSourceRows(
      [row(indicator.id), row(indicator.id)],
      indicator,
      source,
      knownCodes,
    ),
  );
  for (const value of [undefined, "10", NaN, Infinity])
    assert.throws(() =>
      normalizeSourceRows(
        [row(indicator.id, 0, { waarde: value })],
        indicator,
        source,
        knownCodes,
      ),
    );
  assert.throws(() =>
    normalizeSourceRows(
      [row(source.indicators[1].id, 101)],
      source.indicators[1],
      source,
      knownCodes,
    ),
  );
});

test("bundle validation rejects duplicate/out-of-range/unknown series and malformed provenance", async () => {
  const original = await saved();
  const mutations: ((bundle: SourceBundle) => void)[] = [
    (b) => {
      b.sourceId = "income";
    },
    (b) => {
      b.geometryVintage = "2025-01-01";
    },
    (b) => {
      b.years.push(2027);
    },
    (b) => {
      b.areas.push(b.areas[0]);
    },
    (b) => {
      b.variables.push(b.variables[0]);
    },
    (b) => {
      b.variables[0].unit = "%";
    },
    (b) => {
      b.areas[0].series.population_total[2027] = 10;
    },
    (b) => {
      b.areas[0].series.population_children_pct[2026] = 101;
    },
    (b) => {
      b.areas[0].series.population_total[2026] = NaN;
    },
    (b) => {
      delete b.areas[0].series.population_total[2026];
    },
    (b) => {
      b.areas[0].series.unrelated = {};
    },
    (b) => {
      b.provenance[0].url = "https://example.com/";
    },
    (b) => {
      b.provenance[0].sha256 = "broken";
    },
    (b) => {
      b.provenance.push(b.provenance[0]);
    },
    (b) => {
      b.definitions[0].indicatorId = 3036;
    },
  ];
  for (const mutate of mutations) {
    const input = structuredClone(original);
    mutate(input);
    assert.throws(() => validateSourceBundle(input, source));
  }
});

test("merge rejects wrong geography or incomplete map coverage without changing the existing dataset", async () => {
  const data = await base(),
    bundle = await saved();
  assert.throws(() =>
    mergeSource(
      { ...data, meta: { ...data.meta, geometryVintage: "2025-01-01" } },
      bundle,
    ),
  );
  const missing = structuredClone(bundle);
  missing.areas.pop();
  assert.throws(() => mergeSource(data, missing));
  const wrong = structuredClone(bundle);
  wrong.areas[0].code = "BU0363ZZ01";
  assert.throws(() => mergeSource(data, wrong));
  assert.equal(
    data.variables.some((variable) => variable.id === "population_total"),
    false,
  );
  assert.equal(getValue(data, "BU0363AA01", 2026, "population_total"), null);
});

test("re-adding and removing sources keep custom series and base metrics intact", async () => {
  const data = await base();
  data.areas[0].series = { custom: { 2026: 7 } };
  const bundle = await saved();
  const once = mergeSource(data, bundle),
    twice = mergeSource(once, bundle);
  assert.equal(
    twice.variables.filter((variable) => variable.id === "population_total")
      .length,
    1,
  );
  assert.equal(getValue(twice, data.areas[0].code, 2026, "custom"), 7);
  const removed = removeSource(twice, source);
  assert.equal(getValue(removed, data.areas[0].code, 2026, "custom"), 7);
  assert.equal(
    getValue(removed, data.areas[0].code, 2026, "population_total"),
    null,
  );
  assert.equal(getValue(removed, data.areas[0].code, 2026, "woz"), 406560);
  assert.equal(
    once.variables.filter((variable) => variable.id === "population_total")
      .length,
    1,
  );
});
