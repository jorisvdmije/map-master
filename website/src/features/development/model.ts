export type Series = Record<string, number | null>;
export type AreaSeries = {
  code: string;
  name: string;
  woz: Series;
  homes: Series;
  breakYears?: number[];
};
export type Period = { start: number; end: number };
export type Filters = Period & {
  minimum: number;
  stockFilter: boolean;
  maxStockChange: number;
  query: string;
};
export type Comparison = {
  area: AreaSeries;
  startValue: number;
  endValue: number;
  growth: number;
  stockChange: number | null;
  maxStockChange: number | null;
};
export type Exclusion =
  | "boundary-break"
  | "missing-woz"
  | "small-stock"
  | "missing-stock"
  | "changed-stock";

export const defaults: Filters = {
  start: 2016,
  end: 2026,
  minimum: 100,
  stockFilter: true,
  maxStockChange: 20,
  query: "",
};

export function valueAt(series: Series, year: number): number | null {
  const value = series[year];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function validPeriod(period: Period): boolean {
  return (
    Number.isInteger(period.start) &&
    Number.isInteger(period.end) &&
    period.start >= 2000 &&
    period.end <= 2100 &&
    period.start < period.end
  );
}

export function crossesBreak(area: AreaSeries, period: Period): boolean {
  return !!area.breakYears?.some(
    (year) => year > period.start && year <= period.end,
  );
}

export function change(
  start: number | null,
  end: number | null,
): number | null {
  return start !== null && end !== null && start > 0
    ? 100 * (end / start - 1)
    : null;
}

/** Observe every intervening stock count, including temporary construction/demolition. */
export function compare(area: AreaSeries, period: Period): Comparison | null {
  if (!validPeriod(period) || crossesBreak(area, period)) return null;
  const startValue = valueAt(area.woz, period.start);
  const endValue = valueAt(area.woz, period.end);
  const growth = change(startValue, endValue);
  if (startValue === null || endValue === null || growth === null) return null;
  const base = valueAt(area.homes, period.start);
  const deviations = Array.from(
    { length: period.end - period.start + 1 },
    (_, i) => change(base, valueAt(area.homes, period.start + i)),
  );
  return {
    area,
    startValue,
    endValue,
    growth,
    stockChange: change(base, valueAt(area.homes, period.end)),
    maxStockChange: deviations.every((n) => n !== null)
      ? Math.max(...deviations.map((n) => Math.abs(n!)))
      : null,
  };
}

export function exclusion(
  area: AreaSeries,
  filters: Filters,
): Exclusion | null {
  if (crossesBreak(area, filters)) return "boundary-break";
  const comparison = compare(area, filters);
  if (!comparison) return "missing-woz";
  const first = valueAt(area.homes, filters.start);
  const last = valueAt(area.homes, filters.end);
  if (filters.minimum > 0 && (first === null || last === null))
    return "missing-stock";
  if (
    filters.minimum > 0 &&
    (first! < filters.minimum || last! < filters.minimum)
  )
    return "small-stock";
  if (filters.stockFilter && comparison.maxStockChange === null)
    return "missing-stock";
  if (
    filters.stockFilter &&
    comparison.maxStockChange! > filters.maxStockChange + 1e-9
  )
    return "changed-stock";
  return null;
}

/** Search is applied after eligibility, so exclusion counts retain a consistent denominator. */
export function rank(areas: AreaSeries[], filters: Filters, ascending = false) {
  const excluded: Record<Exclusion, number> = {
    "boundary-break": 0,
    "missing-woz": 0,
    "small-stock": 0,
    "missing-stock": 0,
    "changed-stock": 0,
  };
  const eligible: Comparison[] = [];
  for (const area of areas) {
    const reason = exclusion(area, filters);
    if (reason) excluded[reason]++;
    else eligible.push(compare(area, filters)!);
  }
  const query = filters.query.trim().toLocaleLowerCase("nl-NL");
  const rows = eligible.filter(({ area }) =>
    `${area.name} ${area.code}`.toLocaleLowerCase("nl-NL").includes(query),
  );
  rows.sort(
    (a, b) =>
      (ascending ? a.growth - b.growth : b.growth - a.growth) ||
      a.area.code.localeCompare(b.area.code),
  );
  return { rows, excluded, eligible: eligible.length };
}

export function timeline(area: AreaSeries, period: Period, indexed: boolean) {
  if (!validPeriod(period)) return [];
  const base = valueAt(area.woz, period.start);
  const firstBreak = Math.min(
    ...(area.breakYears ?? []).filter((year) => year > period.start),
  );
  return Array.from({ length: period.end - period.start + 1 }, (_, i) => {
    const year = period.start + i;
    const raw = valueAt(area.woz, year);
    const value = indexed
      ? year < firstBreak && raw !== null && base !== null && base > 0
        ? (100 * raw) / base
        : null
      : raw;
    return { year, value, raw };
  });
}

export const number = (value: number | null, digits = 0) =>
  value === null
    ? "—"
    : value.toLocaleString("nl-NL", { maximumFractionDigits: digits });
export const euro = (value: number | null) =>
  value === null ? "—" : `€ ${number(value)}`;
export const percent = (value: number | null) =>
  value === null ? "—" : `${value > 0 ? "+" : ""}${number(value, 1)}%`;

const cell = (value: unknown) =>
  `"${(typeof value === "string" ? value.replace(/^[=+@\-\t\r]/, "'$&") : String(value ?? "")).replaceAll('"', '""')}"`;
export function comparisonCsv(rows: Comparison[], filters: Filters) {
  const header = [
    "buurtcode",
    "buurt",
    "bronjaar_start",
    "bronjaar_eind",
    "waardepeildatum_start",
    "waardepeildatum_eind",
    "woz_start_eur",
    "woz_eind_eur",
    "woz_verandering_pct",
    "woningvoorraad_start",
    "woningvoorraad_eind",
    "voorraad_verandering_pct",
    "max_afwijking_voorraad_pct",
    "minimum_woningen",
    "voorraadfilter",
    "voorraadgrens_pct",
  ];
  return (
    "\uFEFF" +
    [
      header,
      ...rows.map((row) => [
        row.area.code,
        row.area.name,
        filters.start,
        filters.end,
        `${filters.start - 1}-01-01`,
        `${filters.end - 1}-01-01`,
        row.startValue,
        row.endValue,
        row.growth,
        valueAt(row.area.homes, filters.start),
        valueAt(row.area.homes, filters.end),
        row.stockChange,
        row.maxStockChange,
        filters.minimum,
        filters.stockFilter,
        filters.maxStockChange,
      ]),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}
