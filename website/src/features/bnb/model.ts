import type {
  Feature,
  FeatureCollection,
  Point,
  Polygon,
  MultiPolygon,
} from "geojson";
import { booleanIntersects } from "@turf/boolean-intersects";
import { bbox } from "@turf/bbox";
import Papa from "papaparse";
import boundaries from "./wards.json";

export const scenarioDate = "2026-11-03";
export const boundarySource =
  "https://kaart.amsterdam.nl/vergunningen-bed-breakfast";
export const permitSource =
  "https://api.data.amsterdam.nl/v1/docs/datasets/vergunningen.html";
export const queueThreshold = 42; // A demo signal, not a statutory processing deadline.
export type Ward = Feature<
  Polygon | MultiPolygon,
  {
    code: string;
    name: string;
    sourceCategory: string;
    anchor: [number, number];
  }
>;
export type { PropertyMode as HoverMode } from "../examples/property-position";
export { propertyPosition as hoverPosition } from "../examples/property-position";
export type PermitStatus = "granted" | "pending";
export type CapacityMode = "current" | "after-pending";
export type Permit = {
  id: string;
  ward: string;
  label: string;
  status: PermitStatus;
  coordinates: [number, number];
  guests: number;
  pendingDays: number | null;
};
export type Model = {
  wards: FeatureCollection<Polygon | MultiPolygon, Ward["properties"]>;
  permits: Permit[];
  quotas: Record<string, number>;
  anchors: Record<string, [number, number]>;
};
export type Statistics = {
  quota: number;
  granted: number;
  pending: number;
  free: number;
  afterPending: number;
  excess: number;
  guests: number;
  oldPending: number;
  averagePendingDays: number | null;
  medianPendingDays: number | null;
  oldestPendingDays: number | null;
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)]! +
        sorted[Math.floor(sorted.length / 2)]!) /
        2
    : null;
};
export const statusLabel = (status: PermitStatus) =>
  status === "granted" ? "Verleend" : "In behandeling";
export const statusColor = (status: PermitStatus) =>
  status === "granted" ? "#477eb7" : "#d19a3f";
export const available = (stats: Statistics, mode: CapacityMode) =>
  mode === "current" ? stats.free : stats.afterPending;
export const availabilityColor = (free: number) =>
  free === 0
    ? "#e1e8ed"
    : free < 10
      ? "#aec7da"
      : free < 25
        ? "#6c9fbf"
        : "#2c638a";
export const availabilityLabel = (free: number) =>
  free === 0
    ? "Geen ruimte"
    : free < 10
      ? "Bijna vol"
      : free < 25
        ? "Beperkt ruimte"
        : "Ruimte beschikbaar";
export const legend = [
  { label: "0 vrij", color: availabilityColor(0) },
  { label: "1–9 vrij", color: availabilityColor(1) },
  { label: "10–24 vrij", color: availabilityColor(10) },
  { label: "25+ vrij", color: availabilityColor(25) },
];

/** A repeatable demonstration on real boundaries; no permit, quota or location is an actual municipal record. */
export function createBnbModel(): Model {
  const wards = boundaries as Model["wards"];
  const permits: Permit[] = [];
  let seed = 193837;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const normal = () =>
    Math.sqrt(-2 * Math.log(Math.max(random(), Number.EPSILON))) *
    Math.cos(2 * Math.PI * random());
  const quotas: Record<string, number> = {},
    anchors: Model["anchors"] = {};
  for (const ward of wards.features) {
    const { code, name } = ward.properties;
    // Demo figures are independent of the reference map's real availability categories.
    const quota = 18 + Math.floor(random() * 49);
    const pressure = random();
    const free =
      pressure < 0.22
        ? 0
        : pressure < 0.48
          ? 1 + Math.floor(random() * 8)
          : 10 + Math.floor(random() * Math.max(1, quota - 13));
    const granted = Math.max(1, quota - free);
    const pending = name === "Havens-West" ? 0 : Math.floor(random() * 13);
    const bounds = bbox(ward);
    const point = (coordinates: [number, number]): Feature<Point> => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates },
    });
    const inside = (coordinates: [number, number]) =>
      booleanIntersects(point(coordinates), ward);
    quotas[code] = quota;
    const anchor = ward.properties.anchor;
    const sample = (): [number, number] => {
      for (let attempt = 0; attempt < 4000; attempt++) {
        const local = attempt < 80 && random() < 0.85;
        const x = local
          ? anchor[0] + normal() * (bounds[2]! - bounds[0]!) * 0.23
          : bounds[0]! + random() * (bounds[2]! - bounds[0]!);
        const y = local
          ? anchor[1] + normal() * (bounds[3]! - bounds[1]!) * 0.23
          : bounds[1]! + random() * (bounds[3]! - bounds[1]!);
        const coordinates: [number, number] = [
          Number(x.toFixed(6)),
          Number(y.toFixed(6)),
        ];
        if (inside(coordinates)) return coordinates;
      }
      throw new Error(`Could not place a demo location in ${name}.`);
    };
    anchors[code] = inside(anchor) ? anchor : sample();
    for (let i = 0; i < granted + pending; i++) {
      const status: PermitStatus = i < granted ? "granted" : "pending";
      permits.push({
        id: `DEMO-${code}-${String(i + 1).padStart(3, "0")}`,
        ward: code,
        label: `Voorbeeldlocatie ${String(i + 1).padStart(3, "0")} · ${name}`,
        status,
        coordinates: sample(),
        guests: random() < 0.35 ? 2 : 4,
        pendingDays:
          status === "pending" ? 5 + Math.floor(random() * 91) : null,
      });
    }
  }
  return { wards, permits, quotas, anchors };
}

export function wardStats(model: Model, code: string): Statistics {
  const permits = model.permits.filter((p) => p.ward === code);
  const granted = permits.filter((p) => p.status === "granted"),
    pending = permits.filter((p) => p.status === "pending");
  const quota = model.quotas[code] ?? 0;
  const days = pending
    .flatMap((p) => (p.pendingDays === null ? [] : [p.pendingDays]))
    .filter(Number.isFinite);
  const free = Math.max(0, quota - granted.length);
  return {
    quota,
    granted: granted.length,
    pending: pending.length,
    free,
    afterPending: Math.max(0, free - pending.length),
    excess: Math.max(0, pending.length - free),
    guests: granted.reduce((s, p) => s + p.guests, 0),
    oldPending: days.filter((d) => d > queueThreshold).length,
    averagePendingDays: days.length
      ? days.reduce((s, d) => s + d, 0) / days.length
      : null,
    medianPendingDays: median(days),
    oldestPendingDays: days.length ? Math.max(...days) : null,
  };
}
export function cityStats(model: Model): Statistics {
  const areas = model.wards.features.map((d) =>
    wardStats(model, d.properties.code),
  );
  const sum = (
    key:
      | "quota"
      | "granted"
      | "pending"
      | "free"
      | "afterPending"
      | "excess"
      | "guests"
      | "oldPending",
  ) => areas.reduce((total, s) => total + s[key], 0);
  const pending = model.permits.filter(
    (p) => p.status === "pending" && p.pendingDays !== null,
  );
  // Capacity cannot move between wards: aggregate the individually clamped forecasts.
  return {
    quota: sum("quota"),
    granted: sum("granted"),
    pending: sum("pending"),
    free: sum("free"),
    afterPending: sum("afterPending"),
    excess: sum("excess"),
    guests: sum("guests"),
    oldPending: sum("oldPending"),
    averagePendingDays: pending.length
      ? pending.reduce((s, p) => s + p.pendingDays!, 0) / pending.length
      : null,
    medianPendingDays: median(pending.map((p) => p.pendingDays!)),
    oldestPendingDays: pending.length
      ? Math.max(...pending.map((p) => p.pendingDays!))
      : null,
  };
}
export function visiblePermits(
  model: Model,
  ward: string | null,
  status: "all" | PermitStatus,
  query: string,
): Permit[] {
  if (ward === null) return [];
  const search = query.trim().toLocaleLowerCase("nl");
  return model.permits.filter(
    (p) =>
      p.ward === ward &&
      (status === "all" || p.status === status) &&
      (!search ||
        `${p.id} ${p.label} ${statusLabel(p.status)}`
          .toLocaleLowerCase("nl")
          .includes(search)),
  );
}
export function permitGeoJSON(permits: Permit[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: permits.map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Point", coordinates: p.coordinates },
      properties: {
        ward: p.ward,
        label: p.label,
        status: p.status,
        guests: p.guests,
        pendingDays: p.pendingDays,
        dataType: "fictief",
        scenarioDate,
      },
    })),
  };
}
export function permitCSV(permits: Permit[]): string {
  return Papa.unparse(
    {
      fields: [
        "id",
        "locatie",
        "wijk_id",
        "status",
        "gastplaatsen",
        "dagen_in_behandeling",
        "longitude",
        "latitude",
        "datatype",
        "peildatum_scenario",
      ],
      data: permits.map((p) => [
        p.id,
        p.label,
        p.ward,
        statusLabel(p.status),
        p.guests,
        p.pendingDays ?? "",
        ...p.coordinates,
        "fictief",
        scenarioDate,
      ]),
    },
    { escapeFormulae: true },
  );
}
export function wardCSV(model: Model): string {
  return Papa.unparse(
    model.wards.features.map((d) => {
      const s = wardStats(model, d.properties.code);
      return {
        wijk: d.properties.name,
        demoquotum: s.quota,
        verleend: s.granted,
        in_behandeling: s.pending,
        vrij: s.free,
        vrij_na_aanvragen: s.afterPending,
        aanvragen_boven_ruimte: s.excess,
        gastplaatsen: s.guests,
        aanvragen_ouder_dan_42_dagen: s.oldPending,
        gemiddeld_dagen_in_behandeling: s.averagePendingDays,
        mediaan_dagen_in_behandeling: s.medianPendingDays,
        oudste_aanvraag_dagen: s.oldestPendingDays,
        datatype: "fictief",
        peildatum_scenario: scenarioDate,
      };
    }),
    { escapeFormulae: true },
  );
}
