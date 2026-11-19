import type { Dataset, Series, Variable } from "./model";
import {
  CATALOG_GEOMETRY_VINTAGE,
  STATISTICS_ORIGIN,
  STATISTICS_ROOT,
  getSource,
  type SourceDefinition,
  type SourceIndicator,
} from "./catalog.ts";

export type SourceProvenance = { url: string; sha256: string; records: number };
export type IndicatorDefinition = {
  variableId: string;
  indicatorId: number;
  code: string;
  label: string;
  unit: string | null;
  definition: string;
  upstreamSources: string[];
  metadataReference: string;
  recordReference: string;
};
export type SourceBundle = {
  sourceId: string;
  retrievedAt: string;
  geometryVintage: string;
  years: number[];
  variables: Variable[];
  areas: { code: string; series: Record<string, Series> }[];
  provenance: SourceProvenance[];
  definitions: IndicatorDefinition[];
  sha256: string;
  loadedFrom: "snapshot" | "live";
  fallbackReason?: string;
};
export type LoadSourceOptions = {
  signal?: AbortSignal;
  mode?: "snapshot" | "live";
  /** Dependency injection for the offline/hostile-source tests. */
  request?: typeof fetch;
  /** Already validated geometry codes; live loading otherwise gets the official area dimension. */
  knownCodes?: string[];
};

const fingerprintPattern = /^[a-f0-9]{64}$/;
const codePattern = /^BU0363[A-Z]{2}\d{2}$/;
const fail = (
  message = "De databron heeft een onverwacht formaat. De bestaande gegevens zijn bewaard.",
): never => {
  throw new Error(message);
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A continuation may change only page. It cannot redirect to another host/table/filter. */
export function trustedPage(value: string, first: string): string {
  const url = new URL(value),
    initial = new URL(first);
  if (
    url.origin !== STATISTICS_ORIGIN ||
    url.pathname !== initial.pathname ||
    url.username ||
    url.password ||
    url.hash
  )
    fail("De bron stuurde een ongeldige vervolglink.");
  const originalKeys = new Set(initial.searchParams.keys());
  for (const [key, item] of initial.searchParams) {
    if (
      key !== "page" &&
      (url.searchParams.getAll(key).length !== 1 ||
        url.searchParams.get(key) !== item)
    )
      fail("De bron veranderde de gegevensselectie tijdens het laden.");
  }
  for (const key of url.searchParams.keys())
    if (key !== "page" && !originalKeys.has(key))
      fail("De bron voegde een onverwacht paginatiefilter toe.");
  const pages = url.searchParams.getAll("page");
  if (pages.length > 1 || (pages.length && !/^[1-9]\d{0,3}$/.test(pages[0])))
    fail("De bron stuurde een ongeldig paginanummer.");
  return url.href;
}

type Raw = Record<string, unknown>;
export async function readSourcePages(
  first: string,
  table: "cijfers" | "indicatoren" | "gebieden",
  provenance: SourceProvenance[],
  options: Pick<LoadSourceOptions, "signal" | "request"> = {},
): Promise<Raw[]> {
  const request = options.request ?? fetch;
  let next: string | undefined = first,
    total: number | undefined;
  const visited = new Set<string>(),
    rows: Raw[] = [];
  while (next) {
    options.signal?.throwIfAborted();
    const url = trustedPage(next, first);
    if (visited.has(url) || visited.size >= 10)
      fail("De bron herhaalde een pagina of stuurde te veel pagina’s.");
    visited.add(url);
    const timeout = AbortSignal.timeout(15000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    // DSO serves HAL JSON and rejects an application/json-only Accept header with HTTP 406.
    const response = await request(url, { signal, redirect: "error" });
    if (!response.ok)
      fail(`De Amsterdamse API antwoordde met status ${response.status}.`);
    const text = await response.text();
    if (text.length > 25 * 1024 * 1024)
      fail("De bronpagina overschrijdt de toegestane grootte.");
    const data: unknown = JSON.parse(text);
    if (
      !object(data) ||
      !object(data._embedded) ||
      !Array.isArray(data._embedded[table])
    )
      return fail();
    const records = data._embedded[table] as unknown[];
    if (!records.every(object)) fail();
    const page = object(data.page) ? data.page : undefined;
    const advertisedTotal = page?.totalElements;
    if (advertisedTotal !== undefined) {
      if (
        !Number.isSafeInteger(advertisedTotal) ||
        (advertisedTotal as number) < 0 ||
        (total !== undefined && total !== advertisedTotal)
      )
        fail("De bronomvang veranderde tijdens het laden.");
      total = advertisedTotal as number;
    }
    if (
      data.numberReturned !== undefined &&
      data.numberReturned !== records.length
    )
      fail();
    const links = object(data._links) ? data._links : undefined;
    const nextLink = object(links?.next) ? links.next.href : undefined;
    if (nextLink !== undefined && typeof nextLink !== "string") fail();
    const size = Number(new URL(url).searchParams.get("_pageSize"));
    if (!nextLink && size > 0 && records.length >= size)
      fail(
        "Een volle bronpagina mist een vervolglink; de volledigheid is onzeker.",
      );
    rows.push(...(records as Raw[]));
    if (rows.length > 100000)
      fail("De bron overschrijdt de toegestane omvang.");
    provenance.push({
      url,
      sha256: await fingerprint(text),
      records: records.length,
    });
    next = nextLink as string | undefined;
  }
  if (total !== undefined && rows.length !== total)
    fail("De bron bevat minder records dan aangekondigd.");
  return rows;
}

function checkDefinition(
  rows: Raw[],
  indicator: SourceIndicator,
): IndicatorDefinition {
  if (rows.length !== 1) fail("De indicator is niet uniek beschikbaar.");
  const row = rows[0];
  const attributes = object(row.extraAttributen) ? row.extraAttributen : {};
  if (
    row.id !== indicator.id ||
    row.naam !== indicator.code ||
    row.statusVervallen !== false ||
    row.eenheidSymbool !== indicator.unit ||
    attributes.BBGA_peildatum !== indicator.metadataReference ||
    typeof row.label !== "string" ||
    typeof row.definitie !== "string" ||
    !Array.isArray(row.bron) ||
    !row.bron.every((source) => typeof source === "string")
  )
    fail(
      "De indicatordefinitie is gewijzigd; deze bron is niet automatisch gekoppeld.",
    );
  return {
    variableId: indicator.variableId,
    indicatorId: indicator.id,
    code: indicator.code,
    label: row.label as string,
    unit: indicator.unit,
    definition: row.definitie as string,
    upstreamSources: row.bron as string[],
    metadataReference: indicator.metadataReference,
    recordReference: "Peildatum 1 januari van het opgegeven bronjaar",
  };
}

export function normalizeSourceRows(
  rows: Raw[],
  indicator: SourceIndicator,
  source: SourceDefinition,
  knownCodes: string[],
): Map<string, Series> {
  const allowed = new Set(knownCodes),
    seen = new Set<string>(),
    result = new Map<string, Series>();
  for (const row of rows) {
    if (row.indicatorId !== indicator.id)
      fail("Een waarneming hoort bij een andere indicator.");
    if (row.gebiedType !== "Buurt") continue;
    if (row.gebiedCode === "ZZ99") continue;
    if (row.gebiedDatum !== source.geometryVintage)
      fail("Een waarneming gebruikt een andere gebiedsindeling.");
    if (typeof row.gebiedCode !== "string") fail();
    const code = `BU0363${row.gebiedCode}`;
    if (!allowed.has(code))
      fail(`De bron bevat een onbekende buurtcode: ${code}.`);
    if (
      typeof row.heeftBetrekkingOp !== "string" ||
      !/^\d{4}$/.test(row.heeftBetrekkingOp)
    )
      fail("Een bronperiode is geen enkel kalenderjaar.");
    const year = Number(row.heeftBetrekkingOp);
    // Older and newly published years remain outside the explicitly supported source contract.
    if (!source.years.includes(year)) continue;
    if (
      row.tijdType !== indicator.period ||
      row.begindatum !== `${year}-01-01` ||
      row.einddatum !== row.begindatum
    )
      fail("De temporele betekenis van een waarneming is gewijzigd.");
    const key = `${code}:${year}`;
    if (seen.has(key)) fail("De bron bevat een dubbele buurt-jaarwaarneming.");
    seen.add(key);
    if (
      row.waarde !== null &&
      (typeof row.waarde !== "number" || !Number.isFinite(row.waarde))
    )
      fail("De bron bevat een ongeldige numerieke waarde.");
    // Negative sentinel values in this nonnegative catalog are suppressed, not observations.
    const value =
      row.waarde === null || (row.waarde as number) < 0
        ? null
        : (row.waarde as number);
    if (value !== null && indicator.unit === "%" && value > 100)
      fail("Een percentage valt buiten 0–100.");
    if (!result.has(code))
      result.set(
        code,
        Object.fromEntries(source.years.map((year) => [year, null])),
      );
    result.get(code)![year] = value;
  }
  if (
    ![...result.values()].some((series) =>
      Object.values(series).some((value) => value !== null),
    )
  )
    fail(
      "De bron bevat geen gepubliceerde buurtwaarden in de opgegeven jaren.",
    );
  return result;
}

function payload(
  bundle: Pick<
    SourceBundle,
    "sourceId" | "geometryVintage" | "years" | "areas"
  >,
): string {
  return JSON.stringify({
    sourceId: bundle.sourceId,
    geometryVintage: bundle.geometryVintage,
    years: bundle.years,
    areas: bundle.areas,
  });
}

/** Strict boundary for snapshots, cache restores and portable sessions. Known geometry is checked at merge. */
export function validateSourceBundle(
  value: unknown,
  source: SourceDefinition,
): SourceBundle {
  if (!object(value)) return fail();
  const bundle = value as unknown as SourceBundle;
  if (
    bundle.sourceId !== source.id ||
    bundle.geometryVintage !== CATALOG_GEOMETRY_VINTAGE ||
    bundle.geometryVintage !== source.geometryVintage ||
    typeof bundle.retrievedAt !== "string" ||
    !Number.isFinite(Date.parse(bundle.retrievedAt)) ||
    !Array.isArray(bundle.years) ||
    JSON.stringify(bundle.years) !== JSON.stringify(source.years) ||
    !Array.isArray(bundle.variables) ||
    bundle.variables.length !== source.variables.length ||
    !Array.isArray(bundle.areas) ||
    !bundle.areas.length ||
    bundle.areas.length > 1000 ||
    !Array.isArray(bundle.provenance) ||
    !bundle.provenance.length ||
    bundle.provenance.length > 100 ||
    !Array.isArray(bundle.definitions) ||
    bundle.definitions.length !== source.indicators.length ||
    !fingerprintPattern.test(bundle.sha256) ||
    !["snapshot", "live"].includes(bundle.loadedFrom) ||
    (bundle.fallbackReason !== undefined &&
      (typeof bundle.fallbackReason !== "string" ||
        bundle.fallbackReason.length > 500))
  )
    return fail();
  const variableIds = new Set<string>();
  for (const variable of bundle.variables) {
    if (!object(variable)) return fail();
    const expected = source.variables.find(
      (candidate) => candidate.id === variable.id,
    );
    if (
      !expected ||
      variableIds.has(variable.id) ||
      variable.label !== expected.label ||
      variable.unit !== expected.unit ||
      variable.source !== expected.source ||
      variable.kind !== "number" ||
      variable.available !== true ||
      variable.description !== expected.description
    )
      return fail();
    variableIds.add(variable.id);
  }
  const areaCodes = new Set<string>();
  for (const area of bundle.areas) {
    if (
      !object(area) ||
      typeof area.code !== "string" ||
      !codePattern.test(area.code) ||
      areaCodes.has(area.code) ||
      !object(area.series) ||
      Object.keys(area.series).length !== source.variables.length ||
      Object.keys(area.series).some((id) => !variableIds.has(id))
    )
      return fail();
    areaCodes.add(area.code);
    for (const variable of source.variables) {
      const series = area.series[variable.id];
      if (
        !object(series) ||
        Object.keys(series).length !== source.years.length ||
        Object.keys(series).some(
          (year) =>
            !source.years.includes(Number(year)) ||
            String(Number(year)) !== year,
        )
      )
        return fail();
      for (const year of source.years) {
        const number = series[year];
        if (
          number !== null &&
          (typeof number !== "number" ||
            !Number.isFinite(number) ||
            number < 0 ||
            (variable.unit === "%" && number > 100))
        )
          return fail();
      }
    }
  }
  const provenanceUrls = new Set<string>(),
    coveredData = new Set<number>(),
    coveredDefinitions = new Set<number>();
  for (const item of bundle.provenance) {
    if (
      !object(item) ||
      typeof item.url !== "string" ||
      !fingerprintPattern.test(item.sha256) ||
      !Number.isSafeInteger(item.records) ||
      item.records < 0
    )
      return fail();
    const url = new URL(item.url);
    if (provenanceUrls.has(url.href)) return fail();
    provenanceUrls.add(url.href);
    if (url.pathname === "/v1/statistieken/v2/cijfers/") {
      const indicator = source.indicators.find(
        (candidate) =>
          String(candidate.id) === url.searchParams.get("indicator.id"),
      );
      if (!indicator) return fail();
      trustedPage(
        url.href,
        `${STATISTICS_ROOT}cijfers/?indicator.id=${indicator.id}&_pageSize=20000`,
      );
      coveredData.add(indicator.id);
    } else if (url.pathname === "/v1/statistieken/v2/indicatoren/") {
      const indicator = source.indicators.find(
        (candidate) => candidate.code === url.searchParams.get("naam"),
      );
      if (!indicator) return fail();
      trustedPage(
        url.href,
        `${STATISTICS_ROOT}indicatoren/?naam=${encodeURIComponent(indicator.code)}&_pageSize=100`,
      );
      coveredDefinitions.add(indicator.id);
    } else if (url.pathname === "/v1/statistieken/v2/gebieden/") {
      trustedPage(
        url.href,
        `${STATISTICS_ROOT}gebieden/?gebiedstype.id=7&_pageSize=1000`,
      );
    } else return fail();
  }
  if (
    coveredData.size !== source.indicators.length ||
    coveredDefinitions.size !== source.indicators.length
  )
    return fail();
  const definitionIds = new Set<string>();
  for (const definition of bundle.definitions) {
    const expected = source.indicators.find(
      (indicator) => indicator.variableId === definition?.variableId,
    );
    if (
      !expected ||
      definitionIds.has(definition.variableId) ||
      definition.indicatorId !== expected.id ||
      definition.code !== expected.code ||
      definition.unit !== expected.unit ||
      definition.metadataReference !== expected.metadataReference ||
      typeof definition.label !== "string" ||
      typeof definition.definition !== "string" ||
      !Array.isArray(definition.upstreamSources) ||
      !definition.upstreamSources.every((item) => typeof item === "string") ||
      typeof definition.recordReference !== "string"
    )
      return fail();
    definitionIds.add(definition.variableId);
  }
  return structuredClone(bundle);
}

export async function fetchSourceLive(
  source: SourceDefinition,
  options: LoadSourceOptions = {},
): Promise<SourceBundle> {
  const provenance: SourceProvenance[] = [];
  let knownCodes = options.knownCodes;
  if (!knownCodes) {
    const dimension = await readSourcePages(
      `${STATISTICS_ROOT}gebieden/?gebiedstype.id=7&_pageSize=1000`,
      "gebieden",
      provenance,
      options,
    );
    const rows = dimension.filter((row) => row.code !== "ZZ99");
    if (
      rows.length < 500 ||
      rows.some(
        (row) =>
          row.gebiedstypeId !== 7 ||
          row.datum !== source.geometryVintage ||
          typeof row.code !== "string",
      )
    )
      fail("De gebiedsdimensie komt niet overeen met de kaart.");
    knownCodes = rows.map((row) => `BU0363${row.code}`);
  }
  if (
    !knownCodes.length ||
    new Set(knownCodes).size !== knownCodes.length ||
    knownCodes.some((code) => !codePattern.test(code))
  )
    fail("De bekende buurtcodes zijn ongeldig.");
  const codes = knownCodes;
  const results = await Promise.all(
    source.indicators.map(async (indicator) => {
      const [metadata, rows] = await Promise.all([
        readSourcePages(
          `${STATISTICS_ROOT}indicatoren/?naam=${encodeURIComponent(indicator.code)}&_pageSize=100`,
          "indicatoren",
          provenance,
          options,
        ),
        readSourcePages(
          `${STATISTICS_ROOT}cijfers/?indicator.id=${indicator.id}&_pageSize=20000`,
          "cijfers",
          provenance,
          options,
        ),
      ]);
      return {
        indicator,
        definition: checkDefinition(metadata, indicator),
        values: normalizeSourceRows(rows, indicator, source, codes),
      };
    }),
  );
  options.signal?.throwIfAborted();
  const areas = [...codes].sort().map((code) => ({
    code,
    series: Object.fromEntries(
      results.map(({ indicator, values }) => [
        indicator.variableId,
        values.get(code) ??
          Object.fromEntries(source.years.map((year) => [year, null])),
      ]),
    ),
  }));
  const bundle: SourceBundle = {
    sourceId: source.id,
    retrievedAt: new Date().toISOString(),
    geometryVintage: source.geometryVintage,
    years: [...source.years],
    variables: source.variables.map((variable) => ({ ...variable })),
    areas,
    provenance: provenance.sort((a, b) => a.url.localeCompare(b.url)),
    definitions: results.map((result) => result.definition),
    sha256: "",
    loadedFrom: "live",
  };
  bundle.sha256 = await fingerprint(payload(bundle));
  return validateSourceBundle(bundle, source);
}

async function loadSnapshot(
  source: SourceDefinition,
  options: LoadSourceOptions,
): Promise<SourceBundle> {
  options.signal?.throwIfAborted();
  const base =
    (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
      ?.BASE_URL ?? "/";
  if (!/^data\/catalog\/[a-z-]+\.json$/.test(source.snapshotPath))
    fail("Onverwacht snapshotpad.");
  const response = await (options.request ?? fetch)(
    `${base}${source.snapshotPath}`,
    { signal: options.signal },
  );
  if (!response.ok) fail("De bewaarde momentopname kon niet worden geladen.");
  const text = await response.text();
  if (text.length > 10 * 1024 * 1024)
    fail("De momentopname overschrijdt de toegestane omvang.");
  const bundle = validateSourceBundle(JSON.parse(text), source);
  if ((await fingerprint(payload(bundle))) !== bundle.sha256)
    fail("De controlewaarde van de momentopname klopt niet.");
  options.signal?.throwIfAborted();
  return { ...bundle, loadedFrom: "snapshot", fallbackReason: undefined };
}

/** Call on an explicit Add/Refresh action. Failed live loads retain an honest, dated snapshot. */
export async function loadSource(
  source: SourceDefinition,
  options: LoadSourceOptions = {},
): Promise<SourceBundle> {
  if (
    !getSource(source.id) ||
    source.geometryVintage !== CATALOG_GEOMETRY_VINTAGE
  )
    fail("Onbekende databron.");
  if (options.mode === "snapshot" || source.kind === "snapshot")
    return loadSnapshot(source, options);
  try {
    const deadline = AbortSignal.timeout(15000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline;
    return await fetchSourceLive(source, { ...options, signal });
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    const bundle = await loadSnapshot(source, options);
    const reason =
      error instanceof Error
        ? error.message
        : "De live bron is tijdelijk niet beschikbaar.";
    return { ...bundle, fallbackReason: reason.slice(0, 500) };
  }
}

export function mergeSource(dataset: Dataset, value: SourceBundle): Dataset {
  const source = getSource(value.sourceId);
  if (!source) return fail("Onbekende databron.");
  const bundle = validateSourceBundle(value, source);
  if (dataset.meta.geometryVintage !== bundle.geometryVintage)
    return fail("Deze bron gebruikt een andere gebiedsindeling dan de kaart.");
  const knownCodes = new Set(dataset.areas.map((area) => area.code));
  if (
    knownCodes.size !== dataset.areas.length ||
    knownCodes.size !== bundle.areas.length ||
    bundle.areas.some((area) => !knownCodes.has(area.code))
  )
    return fail("De bron en de kaart bevatten verschillende buurten.");
  if (bundle.years.some((year) => !dataset.years.includes(year)))
    return fail("De bron bevat jaren buiten deze werkruimte.");
  const ids = new Set(bundle.variables.map((variable) => variable.id));
  const protectedIds = [
    "woz",
    "homes",
    "year",
    "area",
    "wozGrowth",
    "homesGrowth",
    "priceM2",
  ];
  if ([...ids].some((id) => protectedIds.includes(id)))
    return fail("Een bron probeert een bestaande basisvariabele te vervangen.");
  const index = new Map(bundle.areas.map((area) => [area.code, area.series]));
  return {
    ...dataset,
    areas: dataset.areas.map((area) => ({
      ...area,
      series: { ...area.series, ...index.get(area.code) },
    })),
    variables: [
      ...dataset.variables.filter((variable) => !ids.has(variable.id)),
      ...bundle.variables.map((variable) => ({
        ...variable,
        sourceId: bundle.sourceId,
        years: [...bundle.years],
        retrievedAt: bundle.retrievedAt,
      })),
    ],
  };
}

export function removeSource(
  dataset: Dataset,
  source: SourceDefinition,
): Dataset {
  const ids = new Set(source.variables.map((variable) => variable.id));
  return {
    ...dataset,
    variables: dataset.variables.filter((variable) => !ids.has(variable.id)),
    areas: dataset.areas.map((area) => ({
      ...area,
      series: Object.fromEntries(
        Object.entries(area.series ?? {}).filter(([id]) => !ids.has(id)),
      ),
    })),
  };
}
