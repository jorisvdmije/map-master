import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";

export const themes = [
  "value",
  "homes",
  "people",
  "amenities",
  "energy",
] as const;
export type Theme = (typeof themes)[number];
export const themeLabels: Record<Theme, string> = {
  value: "Waarde & ontwikkeling",
  homes: "Woningen & nieuwbouw",
  people: "Buurt & opleiding",
  amenities: "Voorzieningen",
  energy: "Energie",
};
export const metrics = [
  "woz",
  "wozChange",
  "newBuild",
  "newHomes",
  "owner",
  "rent",
  "socialRent",
  "apartments",
  "vacancy",
  "education",
  "income",
  "lowIncome",
  "householdSize",
  "children",
  "elderly",
  "density",
  "supermarket",
  "gp",
  "school",
  "daycare",
  "gas",
  "electricity",
  "districtHeating",
  "gasFree",
  "solar",
] as const;
export type Metric = (typeof metrics)[number];
export const themeMetrics: Record<Theme, Metric[]> = {
  value: ["woz", "wozChange"],
  homes: [
    "newBuild",
    "newHomes",
    "owner",
    "rent",
    "socialRent",
    "apartments",
    "vacancy",
  ],
  people: [
    "education",
    "income",
    "lowIncome",
    "householdSize",
    "children",
    "elderly",
    "density",
  ],
  amenities: ["supermarket", "gp", "school", "daycare"],
  energy: ["gas", "electricity", "districtHeating", "gasFree", "solar"],
};
export const labels: Record<Metric, string> = {
  woz: "Gemiddelde WOZ",
  wozChange: "WOZ-ontwikkeling",
  newBuild: "Bouwjaar laatste 10 jaar",
  newHomes: "Nieuwbouwwoningen",
  owner: "Koopwoningen",
  rent: "Huurwoningen",
  socialRent: "Woningcorporatiebezit",
  apartments: "Meergezinswoningen",
  vacancy: "Woningen zonder inschrijving",
  education: "Hbo- / wo-opgeleid",
  income: "Inkomen per inwoner",
  lowIncome: "Laagste 40% inkomens",
  householdSize: "Gemiddelde huishoudgrootte",
  children: "Inwoners tot 15 jaar",
  elderly: "Inwoners vanaf 65 jaar",
  density: "Adressendichtheid",
  supermarket: "Afstand supermarkt",
  gp: "Afstand huisarts",
  school: "Afstand basisschool",
  daycare: "Afstand kinderdagverblijf",
  gas: "Gemiddeld gasverbruik",
  electricity: "Gemiddeld stroomverbruik",
  districtHeating: "Stadsverwarming",
  gasFree: "Aardgasvrije woningen",
  solar: "Woningen met zonnestroom",
};
export const units: Record<Metric, string> = {
  woz: "€",
  wozChange: "%",
  newBuild: "%",
  newHomes: "woningen",
  owner: "%",
  rent: "%",
  socialRent: "%",
  apartments: "%",
  vacancy: "%",
  education: "%",
  income: "€/jaar",
  lowIncome: "%",
  householdSize: "personen",
  children: "%",
  elderly: "%",
  density: "adressen/km²",
  supermarket: "km over de weg",
  gp: "km over de weg",
  school: "km over de weg",
  daycare: "km over de weg",
  gas: "m³/jaar",
  electricity: "kWh/jaar",
  districtHeating: "%",
  gasFree: "%",
  solar: "%",
};
export type Indicator = {
  label?: string;
  unit?: string;
  description: string;
  year: number | string;
  referenceYear?: number | null;
  source: string;
};
export type WozPoint = {
  year: number;
  value: number | null;
  valuationDate: string;
  comparable: boolean;
};
export type Neighborhood = Feature<
  Polygon | MultiPolygon,
  {
    code: string;
    name: string;
    year: number;
    hasStatistics: boolean;
    homes: number | null;
    residents: number | null;
    wozPrevious?: number | null;
    wozHistory?: WozPoint[];
  } & Record<Metric, number | null>
>;
export type Snapshot = {
  meta: {
    retrievedAt: string;
    statisticsYear: number;
    wozValuationDate: string;
    sha256: string;
    geometryCount: number;
    statisticsCount: number;
    indicators?: Partial<Record<Metric, Indicator>>;
  };
  data: FeatureCollection<Polygon | MultiPolygon, Neighborhood["properties"]>;
};
export type Home = Feature<
  Point,
  {
    id: string;
    address: string;
    area: number | null;
    use: string;
    status: string;
    buildings: string[];
  }
>;
export type Homes = {
  data: FeatureCollection<Point, Home["properties"]>;
  audit: {
    fetched: number;
    within: number;
    homes: number;
    duplicates: number;
    retrievedAt: string;
  };
};
export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
export function metricValue(row: Neighborhood, metric: Metric): number | null {
  const value = row.properties[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export const number = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("nl-NL", { maximumFractionDigits: digits });
export function format(n: number | null | undefined, metric: Metric) {
  return n == null || !Number.isFinite(n)
    ? "Niet beschikbaar"
    : metric === "woz" || metric === "income"
      ? `€ ${number(n)}${metric === "income" ? "/jaar" : ""}`
      : `${metric === "wozChange" && n > 0 ? "+" : ""}${number(n, ["supermarket", "gp", "school", "daycare", "householdSize", "wozChange", "education"].includes(metric) ? 1 : 0)} ${units[metric]}`;
}
export function extent(rows: Neighborhood[], metric: Metric): [number, number] {
  const values = rows.flatMap((f) =>
    metricValue(f, metric) === null ? [] : [metricValue(f, metric)!],
  );
  if (!values.length) return [0, 1];
  if (metric === "wozChange") {
    const bound = Math.max(...values.map(Math.abs)) || 1;
    return [-bound, bound];
  }
  return [Math.min(...values), Math.max(...values)];
}
export function medianValue(rows: Neighborhood[], metric: Metric) {
  const values = rows
      .flatMap((f) =>
        metricValue(f, metric) === null ? [] : [metricValue(f, metric)!],
      )
      .sort((a, b) => a - b),
    middle = Math.floor(values.length / 2);
  return !values.length
    ? null
    : values.length % 2
      ? values[middle]
      : (values[middle - 1] + values[middle]) / 2;
}
export function color(
  value: number | null,
  range: [number, number],
  metric?: Metric,
) {
  if (value === null) return "#aeb8b7";
  if (metric === "wozChange") {
    const t = Math.min(
      1,
      Math.abs(value) / (Math.max(Math.abs(range[0]), Math.abs(range[1])) || 1),
    );
    return value < 0
      ? `rgb(${Math.round(239 - t * 53)}, ${Math.round(236 - t * 132)}, ${Math.round(225 - t * 146)})`
      : `rgb(${Math.round(239 - t * 211)}, ${Math.round(236 - t * 119)}, ${Math.round(225 - t * 98)})`;
  }
  const t = Math.max(
    0,
    Math.min(1, (value - range[0]) / (range[1] - range[0] || 1)),
  );
  return `rgb(${Math.round(199 - t * 171)}, ${Math.round(227 - t * 110)}, ${Math.round(229 - t * 102)})`;
}
export type RangeFilter = { metric: Metric; min: string; max: string };
export function rangeBound(value: string): number | null {
  if (!value.trim()) return null;
  const text = value.trim();
  // Dutch thousands groups and decimal comma; a single decimal dot stays
  // compatible with the numeric presets (0.5), never with scientific/hex input.
  const grouped = /^[+-]?[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(text);
  if (!grouped && !/^[+-]?\d+(?:[,.]\d+)?$/.test(text)) return null;
  const parsed = Number(
    (grouped ? text.replaceAll(".", "") : text).replace(",", "."),
  );
  return Number.isFinite(parsed) ? parsed : null;
}
export function rangeError(filter: RangeFilter): string | null {
  const min = rangeBound(filter.min),
    max = rangeBound(filter.max);
  if (
    (filter.min.trim() && min === null) ||
    (filter.max.trim() && max === null)
  )
    return "Vul een geldig getal in.";
  return min !== null && max !== null && min > max
    ? "Het minimum is groter dan het maximum."
    : null;
}
export function filtered(
  rows: Neighborhood[],
  query: string,
  minimum: number,
  ranges: RangeFilter[] = [],
  known?: Metric,
) {
  const words = query
    .toLocaleLowerCase("nl")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return rows.filter(
    (f) =>
      (f.properties.homes ?? 0) >= minimum &&
      words.every((word) =>
        `${f.properties.name} ${f.properties.code}`
          .toLocaleLowerCase("nl")
          .includes(word),
      ) &&
      (!known || metricValue(f, known) !== null) &&
      ranges.every((filter) => {
        if (rangeError(filter)) return false;
        const min = rangeBound(filter.min),
          max = rangeBound(filter.max);
        if (min === null && max === null) return true;
        const value = metricValue(f, filter.metric);
        return (
          value !== null &&
          (min === null || value >= min) &&
          (max === null || value <= max)
        );
      }),
  );
}
export function sortNeighborhoods(
  rows: Neighborhood[],
  metric: Metric,
  ascending = false,
) {
  return [...rows].sort((a, b) => {
    const av = metricValue(a, metric),
      bv = metricValue(b, metric);
    if (av === null || bv === null)
      return av === bv
        ? a.properties.name.localeCompare(b.properties.name, "nl")
        : av === null
          ? 1
          : -1;
    return (
      (ascending ? av - bv : bv - av) ||
      a.properties.name.localeCompare(b.properties.name, "nl")
    );
  });
}
export function areasCsv(
  rows: Neighborhood[],
  indicators?: Snapshot["meta"]["indicators"],
) {
  const cell = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      [
        "Buurtcode",
        "Buurt",
        "CBS-jaar",
        "Woningen",
        ...metrics.map(
          (m) =>
            `${labels[m]} (${units[m]}; CBS ${indicators?.[m]?.year ?? (["education", "income", "lowIncome"].includes(m) ? 2024 : 2025)})`,
        ),
      ],
      ...rows.map((f) => [
        f.properties.code,
        f.properties.name,
        f.properties.year,
        f.properties.homes,
        ...metrics.map((m) => metricValue(f, m)),
      ]),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}

/** Search stays within explicitly loaded BAG homes; identities retain leading zeroes. */
export function matchingHomes(homes: Home[], query: string) {
  const words = query
    .trim()
    .toLocaleLowerCase("nl")
    .split(/\s+/)
    .filter(Boolean);
  return homes
    .filter((home) =>
      words.every(
        (word) =>
          home.properties.address.toLocaleLowerCase("nl").includes(word) ||
          home.properties.id === word,
      ),
    )
    .sort(
      (a, b) =>
        a.properties.address.localeCompare(b.properties.address, "nl", {
          numeric: true,
        }) || a.properties.id.localeCompare(b.properties.id),
    );
}
