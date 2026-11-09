import Papa from "papaparse";
import { observationMeta, sum, type Counts, type Observation } from "./model";

export type ShiftKind = "reports" | "nuisance" | "maintenance";
export type ShiftSettings = {
  kind: ShiftKind;
  minimum: number;
  direction: "up" | "down" | "all";
  sort: "count" | "relative";
};
export const defaultShift: ShiftSettings = {
  kind: "reports",
  minimum: 30,
  direction: "up",
  sort: "count",
};
export const shiftLabels: Record<ShiftKind, string> = {
  reports: "Alle meldingen",
  nuisance: "Overlastmeldingen",
  maintenance: "Wegen & onderhoud",
};
export type ShiftReason =
  | "short"
  | "total"
  | "baseline"
  | "reference"
  | "expected";
export const shiftReasons: Record<ShiftReason, string> = {
  short: "Minder dan 100 m NWB",
  total: "Onder het gekozen jaartotaal",
  baseline: "Minder dan 5 eerdere meldingen",
  reference: "Geen bruikbare stadsreferentie",
  expected: "Referentie onder 5 meldingen",
};
export type ShiftRow = {
  id: string;
  name: string;
  length: number;
  series: number[];
  before: number;
  recent: number;
  expected: number | null;
  expectedSeries: (number | null)[];
  excess: number | null;
  relative: number | null;
  aboveMonths: number;
  reason: ShiftReason | null;
};

/** Fixed non-overlapping 9/3-month windows. Compare each street to the REST of
 * the city, so neither filtering nor the street's own surge changes its control.
 * This is an accounting reference, not a forecast, causal model or significance test.
 */
export function shiftAnalysis(
  rows: Observation[],
  city: Counts,
  kind: ShiftKind,
  minimum = 30,
) {
  const citySeries = city[kind],
    cityBefore = sum(citySeries.slice(0, 9)),
    cityRecent = sum(citySeries.slice(9));
  const results: ShiftRow[] = rows.map((row) => {
    const series = row.raw[kind],
      before = sum(series.slice(0, 9)),
      recent = sum(series.slice(9));
    const restBefore = cityBefore - before,
      restRecent = cityRecent - recent;
    const valid =
      restBefore > 0 &&
      restRecent > 0 &&
      before > 0 &&
      citySeries.every((n, i) => n >= series[i]!);
    const expectedSeries = series.map((n, i) =>
      valid ? (before / restBefore) * (citySeries[i]! - n) : null,
    );
    const expected = valid ? (before / restBefore) * restRecent : null;
    const reason: ShiftReason | null =
      row.length < 100
        ? "short"
        : before + recent < minimum
          ? "total"
          : before < 5
            ? "baseline"
            : !valid
              ? "reference"
              : expected! < 5
                ? "expected"
                : null;
    return {
      id: row.id,
      name: row.name,
      length: row.length,
      series: [...series],
      before,
      recent,
      expected,
      expectedSeries,
      excess: expected === null ? null : recent - expected,
      relative: expected === null ? null : (recent / expected - 1) * 100,
      aboveMonths: series
        .slice(9)
        .filter(
          (n, i) =>
            expectedSeries[i + 9] !== null && n > expectedSeries[i + 9]!,
        ).length,
      reason,
    };
  });
  return {
    rows: results,
    eligible: results.filter((r) => r.reason === null),
    excluded: results.filter((r) => r.reason !== null).length,
    exclusions: Object.entries(shiftReasons).map(([reason, label]) => ({
      reason,
      label,
      count: results.filter((r) => r.reason === reason).length,
    })),
    citySeries,
    cityBefore,
    cityRecent,
  };
}
export function rankShifts(rows: ShiftRow[], settings: ShiftSettings) {
  const key = settings.sort === "relative" ? "relative" : "excess";
  return rows
    .filter(
      (r) =>
        r.reason === null &&
        r.excess !== null &&
        (settings.direction === "all" ||
          (settings.direction === "up" ? r.excess > 0 : r.excess < 0)),
    )
    .sort(
      (a, b) =>
        (settings.direction === "all"
          ? Math.abs(b[key]!) - Math.abs(a[key]!)
          : settings.direction === "up"
            ? b[key]! - a[key]!
            : a[key]! - b[key]!) || a.name.localeCompare(b.name),
    );
}
export const shiftMethod = {
  baselineMonths: observationMeta.months.slice(0, 9),
  recentMonths: observationMeta.months.slice(9),
  formula:
    "expected_recent = street_baseline * (city_recent - street_recent) / (city_baseline - street_baseline)",
  reference:
    "All matched Amsterdam NWB roads, excluding this street; fixed regardless of filters and period selector",
  eligibility:
    "NWB length >=100m, baseline >=5, expected recent >=5, and user-selected annual count minimum",
  interpretation:
    "Descriptive change relative to rest of city; no prediction, safety score, causal effect or significance test. One year cannot estimate local seasonal patterns. Reporting behaviour, incidents, works and duplicates can affect counts.",
};
export function shiftsCSV(rows: ShiftRow[], kind: ShiftKind, minimum = 30) {
  return Papa.unparse(
    rows.map((r) => ({
      straat: r.name,
      onderwerp: shiftLabels[kind],
      minimum_jaartotaal: minimum,
      lengte_m_NWB: r.length,
      eerder_9_maanden: r.before,
      recent_3_maanden: r.recent,
      referentie_recent: r.expected,
      verschil_aantal: r.excess,
      verschil_procent: r.relative,
      recente_maanden_boven_referentie: r.aboveMonths,
      rangschikbaar: r.reason === null,
      uitsluiting: r.reason ? shiftReasons[r.reason] : "",
      ...Object.fromEntries(
        observationMeta.months.map((month, i) => [month, r.series[i]]),
      ),
      periode_eerder: observationMeta.months.slice(0, 9).join(" / "),
      periode_recent: observationMeta.months.slice(9).join(" / "),
      formule: shiftMethod.formula,
      datatype: "observed_counts_derived_spatially",
      bron: "Gemeente Amsterdam MORA + NWB",
      peildatum_download: observationMeta.retrieved,
      countsSha256: observationMeta.countsSha256,
    })),
    { escapeFormulae: true },
  );
}
