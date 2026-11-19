import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

export type Series = Record<string, number | null>;
export type Variable = {
  id: string;
  label: string;
  unit: string;
  description: string;
  source: string;
  kind: "number" | "time" | "geo";
  available: boolean;
  /** Optional explicit coverage and per-source provenance for lazily added metrics. */
  years?: number[];
  sourceId?: string;
  retrievedAt?: string;
};
export type Area = {
  code: string;
  name: string;
  breakYears?: number[];
  woz: Series;
  homes: Series;
  /** Additional, explicitly sourced values, for example an imported priceM2 series. */
  series?: Record<string, Series>;
};
export type Observation = {
  areaCode: string;
  year: number;
  values: Record<string, number | null>;
};
export type Geometry = FeatureCollection<
  Polygon | MultiPolygon,
  { code: string; name: string }
>;
export type Dataset = {
  areas: Area[];
  years: number[];
  variables: Variable[];
  geometry: Geometry;
  meta: {
    retrievedAt: string;
    geometryVintage: string;
    valuationDates?: Record<string, string>;
    method?: string;
    sha256?: string;
    [key: string]: unknown;
  };
};
export type BlockKind =
  | "map"
  | "timeseries"
  | "regression"
  | "ranking"
  | "table"
  | "stat";
export type Block = {
  id: string;
  kind: BlockKind;
  title: string;
  x: string;
  y: string;
  wide: boolean;
  mode?: "value" | "index" | "growth";
};
export type Workspace = {
  version: 1;
  name: string;
  start: number;
  end: number;
  year: number;
  selected: string[];
  selectionOnly: boolean;
  blocks: Block[];
};

export const SOURCE =
  "https://onderzoek.amsterdam.nl/dataset/basisbestand-gebieden-amsterdam-bbga";
export const VARIABLES: Variable[] = [
  {
    id: "year",
    label: "Jaar",
    unit: "jaar",
    kind: "time",
    available: true,
    source: SOURCE,
    description:
      "Bronjaar van de waarneming. WOZ heeft waardepeildatum 1 januari van het voorgaande jaar.",
  },
  {
    id: "area",
    label: "Buurt",
    unit: "buurt",
    kind: "geo",
    available: true,
    source: SOURCE,
    description:
      "Amsterdamse buurten volgens de gebiedsindeling van 24 maart 2022.",
  },
  {
    id: "woz",
    label: "Gemiddelde WOZ",
    unit: "€",
    kind: "number",
    available: true,
    source: SOURCE,
    description:
      "Gepubliceerde gemiddelde WOZ-waarde per woning in euro. Geen verkoopprijs of prijs per m². Veranderingen in de woningmix kunnen het gemiddelde beïnvloeden.",
  },
  {
    id: "homes",
    label: "Woningvoorraad",
    unit: "woningen",
    kind: "number",
    available: true,
    source: SOURCE,
    description:
      "BAG-woonadressen op 1 januari, exclusief woonboten en standplaatsen. Vanaf 2015 omvat de definitie ook kleinere huurwoningen, zoals studentenwoningen.",
  },
  {
    id: "wozGrowth",
    label: "WOZ-groei",
    unit: "%",
    kind: "number",
    available: true,
    source: SOURCE,
    description:
      "Jaar-op-jaarverandering van de gemiddelde WOZ per buurt. Onbekend bij ontbrekende basiswaarde of een bekende grenswijziging.",
  },
  {
    id: "homesGrowth",
    label: "Voorraadgroei",
    unit: "%",
    kind: "number",
    available: true,
    source: SOURCE,
    description:
      "Jaar-op-jaarverandering van de BAG-woningvoorraad. Geen bouwproductie: ook conversie en registratie kunnen meespelen. Over de definitiewijziging in 2015 niet berekend.",
  },
  {
    id: "priceM2",
    label: "Vierkantemeterprijs",
    unit: "€/m²",
    kind: "number",
    available: false,
    source: SOURCE,
    description:
      "Niet aanwezig in deze bron. Voeg eigen buurt-jaardata met een echte prijs per m² toe. WOZ per woning wordt nooit als m²-prijs weergegeven of uit een ongerelateerd oppervlak afgeleid.",
  },
];

const areaIndexes = new WeakMap<Dataset, Map<string, Area>>();
function findArea(dataset: Dataset, code: string): Area | undefined {
  let index = areaIndexes.get(dataset);
  if (!index) {
    index = new Map(dataset.areas.map((area) => [area.code, area]));
    areaIndexes.set(dataset, index);
  }
  return index.get(code);
}

export function numericVariables(dataset: Dataset): Variable[] {
  return dataset.variables.filter(
    (variable) => variable.kind === "number" && variable.available,
  );
}

export function percentChange(
  first: number | null,
  last: number | null,
): number | null {
  return first !== null &&
    last !== null &&
    Number.isFinite(first) &&
    Number.isFinite(last) &&
    first > 0
    ? 100 * (last / first - 1)
    : null;
}

export function crossesBreak(area: Area, start: number, end: number): boolean {
  return !!area.breakYears?.some((year) => year > start && year <= end);
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export function getValue(
  dataset: Dataset,
  code: string,
  year: number,
  variableId: string,
): number | null {
  const area = findArea(dataset, code);
  if (!area || !dataset.years.includes(year)) return null;
  if (variableId === "year") return year;
  if (variableId === "woz" || variableId === "homes")
    return finite(area[variableId][year]);
  if (variableId === "wozGrowth" || variableId === "homesGrowth") {
    if (
      crossesBreak(area, year - 1, year) ||
      (variableId === "homesGrowth" && year === 2015)
    )
      return null;
    const raw = variableId === "wozGrowth" ? area.woz : area.homes;
    return percentChange(finite(raw[year - 1]), finite(raw[year]));
  }
  return finite(area.series?.[variableId]?.[year]);
}

export function timeSeries(
  dataset: Dataset,
  code: string,
  variableId: string,
  start: number,
  end: number,
  mode: "value" | "index" | "growth" = "value",
): {
  year: number;
  value: number | null;
  raw: number | null;
  breakBefore: boolean;
}[] {
  const area = findArea(dataset, code);
  if (
    !area ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start > end
  )
    return [];
  const base = getValue(dataset, code, start, variableId);
  return dataset.years
    .filter((year) => year >= start && year <= end)
    .map((year) => {
      const raw = getValue(dataset, code, year, variableId);
      const breakBefore = !!area.breakYears?.includes(year);
      let value = raw;
      if (mode === "index")
        value =
          base !== null &&
          base > 0 &&
          raw !== null &&
          !crossesBreak(area, start, year)
            ? (100 * raw) / base
            : null;
      if (mode === "growth") {
        value =
          crossesBreak(area, year - 1, year) ||
          (variableId === "homes" && year === 2015)
            ? null
            : percentChange(getValue(dataset, code, year - 1, variableId), raw);
      }
      // SVG line renderers that only consume value still cannot bridge a known boundary break.
      if (breakBefore && year > start) value = null;
      return { year, value, raw, breakBefore };
    });
}

export type Point = { x: number; y: number; code?: string; name?: string };
export type Regression = {
  n: number;
  slope: number;
  intercept: number;
  r2: number | null;
  correlation: number | null;
  xMin: number;
  xMax: number;
  residuals: number[];
};

/** One observation per neighborhood in the selected year, never pooled repeated observations. */
export function pairedPoints(
  dataset: Dataset,
  year: number,
  x: string,
  y: string,
  codes?: string[],
): Point[] {
  const selected = codes ? new Set(codes) : null;
  return dataset.areas
    .filter((area) => !selected || selected.has(area.code))
    .flatMap((area) => {
      const xv = getValue(dataset, area.code, year, x);
      const yv = getValue(dataset, area.code, year, y);
      return xv === null || yv === null
        ? []
        : [{ x: xv, y: yv, code: area.code, name: area.name }];
    });
}

/** Centered OLS with an intercept. Descriptive association; no causal or forecasting claims. */
export function regress(input: Point[]): Regression | null {
  const points = input.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((sum, point) => sum + point.x / n, 0);
  const my = points.reduce((sum, point) => sum + point.y / n, 0);
  const xx = points.reduce((sum, point) => sum + (point.x - mx) ** 2, 0);
  const yy = points.reduce((sum, point) => sum + (point.y - my) ** 2, 0);
  const xy = points.reduce(
    (sum, point) => sum + (point.x - mx) * (point.y - my),
    0,
  );
  if (!Number.isFinite(xx) || xx === 0) return null;
  const slope = xy / xx;
  const intercept = my - slope * mx;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;
  const correlation =
    yy > 0 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
  return {
    n,
    slope,
    intercept,
    correlation,
    r2: correlation === null ? null : correlation ** 2,
    xMin: Math.min(...points.map((point) => point.x)),
    xMax: Math.max(...points.map((point) => point.x)),
    residuals: points.map((point) => point.y - (intercept + slope * point.x)),
  };
}

export function formatValue(
  value: number | null,
  variable: Variable | string,
  compact = false,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const unit = typeof variable === "string" ? variable : variable.unit;
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits: unit === "%" || unit === "€/m²" ? 1 : 0,
    ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
  };
  const number = value.toLocaleString("nl-NL", options);
  if (unit === "€") return `€ ${number}`;
  if (unit === "€/m²") return `€ ${number}/m²`;
  if (unit === "%") return `${number}%`;
  return number;
}

/** Spreadsheet-safe text cells; numeric values retain their exact machine-readable value. */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe =
    typeof value === "string" ? raw.replace(/^[=+@\-\t\r]/, "'$&") : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportCsv(dataset: Dataset, workspace: Workspace): string {
  const ids = [
    ...new Set(workspace.blocks.flatMap((block) => [block.x, block.y])),
  ].filter((id) =>
    numericVariables(dataset).some((variable) => variable.id === id),
  );
  const codes = workspace.selectionOnly ? new Set(workspace.selected) : null;
  const columns = [
    "buurtcode",
    "buurt",
    "jaar",
    ...ids.flatMap((id) => [id, `${id}_eenheid`, `${id}_bron`]),
    "geometrie_indeling",
    "bron",
    "opgehaald_op",
  ];
  const rows = dataset.areas
    .filter((area) => !codes || codes.has(area.code))
    .flatMap((area) =>
      dataset.years
        .filter((year) => year >= workspace.start && year <= workspace.end)
        .map((year) => [
          area.code,
          area.name,
          year,
          ...ids.flatMap((id) => [
            getValue(dataset, area.code, year, id),
            dataset.variables.find((variable) => variable.id === id)?.unit ??
              "",
            dataset.variables.find((variable) => variable.id === id)?.source ??
              "",
          ]),
          dataset.meta.geometryVintage,
          SOURCE,
          dataset.meta.retrievedAt,
        ]),
    );
  return (
    "\uFEFF" +
    [columns, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")
  );
}

export function observations(
  dataset: Dataset,
  variableIds = numericVariables(dataset).map((variable) => variable.id),
): Observation[] {
  return dataset.areas.flatMap((area) =>
    dataset.years.map((year) => ({
      areaCode: area.code,
      year,
      values: Object.fromEntries(
        variableIds.map((id) => [id, getValue(dataset, area.code, year, id)]),
      ),
    })),
  );
}

type Snapshot = { areas: Area[]; meta: Dataset["meta"] & { years: number[] } };

export function makeDataset(snapshot: unknown, geometry: unknown): Dataset {
  const fail = (): never => {
    throw new Error(
      "De bronbestanden hebben een onverwacht formaat. Ververs de databron en probeer opnieuw.",
    );
  };
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !geometry ||
    typeof geometry !== "object"
  )
    fail();
  const s = snapshot as Snapshot;
  const g = geometry as Geometry;
  if (
    !s.meta ||
    !Array.isArray(s.areas) ||
    !s.areas.length ||
    !Array.isArray(s.meta.years) ||
    s.meta.years.length < 2 ||
    !s.meta.years.every(
      (year, i, years) =>
        Number.isInteger(year) &&
        year >= 2000 &&
        year <= 2100 &&
        (!i || year === years[i - 1] + 1),
    ) ||
    typeof s.meta.retrievedAt !== "string" ||
    !Number.isFinite(Date.parse(s.meta.retrievedAt)) ||
    typeof s.meta.geometryVintage !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.meta.geometryVintage) ||
    g.type !== "FeatureCollection" ||
    !Array.isArray(g.features)
  )
    fail();
  const codes = new Set<string>();
  for (const area of s.areas) {
    if (
      !area ||
      typeof area.code !== "string" ||
      typeof area.name !== "string" ||
      codes.has(area.code)
    )
      fail();
    codes.add(area.code);
    if (
      area.breakYears &&
      (!Array.isArray(area.breakYears) ||
        !area.breakYears.every((year) => Number.isInteger(year)))
    )
      fail();
    for (const series of [area.woz, area.homes]) {
      if (
        !series ||
        typeof series !== "object" ||
        Array.isArray(series) ||
        !s.meta.years.every(
          (year) =>
            series[year] === null ||
            (typeof series[year] === "number" &&
              Number.isFinite(series[year]) &&
              series[year]! >= 0),
        )
      )
        fail();
    }
  }
  const geometryCodes = new Set<string>();
  const ringValid = (ring: unknown): boolean =>
    Array.isArray(ring) &&
    ring.length >= 4 &&
    ring.every(
      (point: unknown) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === "number" &&
        Number.isFinite(point[0]) &&
        Math.abs(point[0]) <= 180 &&
        typeof point[1] === "number" &&
        Number.isFinite(point[1]) &&
        Math.abs(point[1]) < 85,
    ) &&
    ring[0][0] === ring.at(-1)[0] &&
    ring[0][1] === ring.at(-1)[1];
  const polygonValid = (polygon: unknown): boolean =>
    Array.isArray(polygon) && polygon.length > 0 && polygon.every(ringValid);
  for (const feature of g.features) {
    if (
      !feature ||
      feature.type !== "Feature" ||
      !feature.properties ||
      !codes.has(feature.properties.code) ||
      geometryCodes.has(feature.properties.code) ||
      !feature.geometry ||
      (feature.geometry.type === "Polygon"
        ? !polygonValid(feature.geometry.coordinates)
        : feature.geometry.type === "MultiPolygon"
          ? !Array.isArray(feature.geometry.coordinates) ||
            !feature.geometry.coordinates.length ||
            !feature.geometry.coordinates.every(polygonValid)
          : true)
    )
      fail();
    geometryCodes.add(feature.properties.code);
  }
  if (geometryCodes.size !== codes.size) fail();
  return {
    areas: s.areas,
    years: [...s.meta.years],
    geometry: g,
    variables: VARIABLES.map((variable) => ({ ...variable })),
    meta: s.meta,
  };
}

export async function loadDataset(
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Dataset> {
  const base =
    (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
      ?.BASE_URL ?? "/";
  const read = async (file: string): Promise<unknown> => {
    const response = await request(`${base}data/${file}`, { signal });
    if (!response.ok)
      throw new Error(
        "De Amsterdamse data konden niet worden geladen. Probeer opnieuw.",
      );
    return response.json();
  };
  const [snapshot, geometry] = await Promise.all([
    read("amsterdam-development.json"),
    read("amsterdam-development-geometry.json"),
  ]);
  signal?.throwIfAborted();
  return makeDataset(snapshot, geometry);
}
