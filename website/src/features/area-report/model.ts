import { booleanIntersects } from "@turf/boolean-intersects";
import type { Polygon, Position } from "geojson";
import {
  format,
  labels,
  metrics,
  metricValue,
  units,
  type Home,
  type Metric,
  type Neighborhood,
  type Snapshot,
} from "../housing/model";

export type ReportPoint = {
  coordinates: [number, number];
  kind: "example" | "address" | "shared";
  label: string;
};
export const reportGroups: { id: string; title: string; metrics: Metric[] }[] =
  [
    {
      id: "wonen",
      title: "Wonen",
      metrics: [
        "woz",
        "wozChange",
        "owner",
        "rent",
        "socialRent",
        "apartments",
        "newBuild",
        "newHomes",
        "vacancy",
      ],
    },
    {
      id: "bewoners",
      title: "Bewoners",
      metrics: [
        "householdSize",
        "children",
        "elderly",
        "education",
        "income",
        "lowIncome",
        "density",
      ],
    },
    {
      id: "energie",
      title: "Energie",
      metrics: ["gas", "electricity", "districtHeating", "gasFree", "solar"],
    },
  ];
export const amenityMetrics: Metric[] = [
  "supermarket",
  "gp",
  "school",
  "daycare",
];
export const cbsSource = "https://www.cbs.nl/nl-nl/cijfers/detail/86165NED";
export const addressSource = "https://www.pdok.nl/pdok-locatieserver";
export function contains(area: Neighborhood, coordinates: [number, number]) {
  return booleanIntersects(area, { type: "Point", coordinates });
}
export function areasAt(rows: Neighborhood[], coordinates: [number, number]) {
  return rows.filter((row) => contains(row, coordinates));
}

/** Horizontal scan lines through the largest part, with holes removed. Never use
 * a bounding-box centre as a location: it can lie outside the area or in water. */
export function examplePoint(area: Neighborhood): [number, number] {
  const parts =
    area.geometry.type === "Polygon"
      ? [area.geometry.coordinates]
      : area.geometry.coordinates;
  const ringArea = (ring: Position[]) =>
    Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0),
    );
  for (const rings of [...parts].sort(
    (a, b) => ringArea(b[0]) - ringArea(a[0]),
  )) {
    const ys = rings[0].map((p) => p[1]),
      min = Math.min(...ys),
      max = Math.max(...ys);
    for (const fraction of [0.5, 0.25, 0.75, 0.125, 0.875]) {
      const y = min + fraction * (max - min),
        xs: number[] = [];
      for (const ring of rings)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i];
          if (a[1] > y !== b[1] > y)
            xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      xs.sort((a, b) => a - b);
      const spans = [];
      for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
      for (const [left, right] of spans.sort(
        (a, b) => b[1] - b[0] - (a[1] - a[0]),
      )) {
        const point: [number, number] = [(left + right) / 2, y];
        if (contains(area, point)) return point;
      }
    }
  }
  // A polygon vertex is on its boundary, which is included in the spatial join.
  return [...parts[0][0][0]].slice(0, 2) as [number, number];
}

export function selectedPoint(
  area: Neighborhood,
  params: URLSearchParams,
): ReportPoint {
  const lng = params.get("lng"),
    lat = params.get("lat");
  const point: [number, number] = [Number(lng), Number(lat)];
  if (
    lng?.trim() &&
    lat?.trim() &&
    point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 180 &&
    Math.abs(point[1]) <= 90 &&
    contains(area, point)
  )
    return { coordinates: point, kind: "shared", label: "Gedeeld locatiepunt" };
  return {
    coordinates: examplePoint(area),
    kind: "example",
    label: "Voorbeeldpunt in deze buurt",
  };
}
export const pointKey = (point: ReportPoint) => point.coordinates.join(",");
export function reportHref(code: string, coordinates?: [number, number]) {
  const params = new URLSearchParams({ buurt: code });
  if (coordinates) {
    params.set("lng", String(coordinates[0]));
    params.set("lat", String(coordinates[1]));
  }
  return `/area-report/?${params}`;
}
export function pointHome(point: ReportPoint): Home {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: point.coordinates },
    properties: {
      id: `report:${pointKey(point)}`,
      address: point.label,
      area: null,
      use: "",
      status: "",
      buildings: [],
    },
  };
}
export function reportMetrics(area: Neighborhood, meta: Snapshot["meta"]) {
  return metrics.map((key) => {
    const indicator = meta.indicators?.[key];
    return {
      key,
      label: indicator?.label ?? labels[key],
      value: metricValue(area, key),
      formatted: format(metricValue(area, key), key),
      unit: indicator?.unit ?? units[key],
      tableYear: indicator?.year ?? null,
      referenceYear: indicator?.referenceYear ?? null,
      source: indicator?.source ?? cbsSource,
      definition:
        indicator?.description ?? "Geen aanvullende definitie vastgelegd.",
      scope: "CBS-buurt",
    };
  });
}
export type LiveResult<T> = {
  status:
    | "not-requested"
    | "loading"
    | "unavailable"
    | "success"
    | "stale-after-error";
  data: T | null;
};
export function liveResult<T>(query: {
  data?: T;
  isFetching: boolean;
  error: unknown;
}): LiveResult<T> {
  return {
    status: query.isFetching
      ? "loading"
      : query.error
        ? query.data === undefined
          ? "unavailable"
          : "stale-after-error"
        : query.data === undefined
          ? "not-requested"
          : "success",
    data: query.data ?? null,
  };
}
export function reportExport(
  area: Neighborhood,
  meta: Snapshot["meta"],
  point: ReportPoint,
  environment: Record<string, LiveResult<unknown>>,
) {
  return {
    format: "map-master-area-report",
    version: 1,
    exportedAt: new Date().toISOString(),
    area,
    point,
    statistics: reportMetrics(area, meta),
    population: {
      residents: area.properties.residents,
      homes: area.properties.homes,
      tableYear: meta.statisticsYear,
      source: cbsSource,
    },
    environment,
    provenance: meta,
    meaning:
      "CBS-cijfers gelden voor de gehele buurt. Bomen binnen 250 meter, geluid en reistijdbereik gelden alleen rond het gekozen locatiepunt. Een voorbeeldpunt is geen vastgesteld adres of representatieve buurtmeting. Ontbrekende cijfers blijven null. Een opvraagdatum is geen bronjaar.",
  };
}
export function reportCsv(area: Neighborhood, meta: Snapshot["meta"]) {
  const cell = (value: unknown) => {
    const s = String(value ?? "");
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      [
        "Buurtcode",
        "Buurt",
        "Kenmerk",
        "Waarde",
        "Eenheid",
        "Tabeljaar",
        "Waarnemingsjaar",
        "Bron",
        "Definitie",
      ],
      ...reportMetrics(area, meta).map((m) => [
        area.properties.code,
        area.properties.name,
        m.label,
        m.value,
        m.unit,
        m.tableYear,
        m.referenceYear,
        m.source,
        m.definition,
      ]),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}

export function areaShape(area: Neighborhood, point: ReportPoint) {
  const polygons =
    area.geometry.type === "Polygon"
      ? [area.geometry.coordinates]
      : area.geometry.coordinates;
  const all = polygons.flat(2),
    xs = all.map((p) => p[0]),
    ys = all.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const correction = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const scale =
    200 / Math.max((maxX - minX) * correction, maxY - minY, 0.000001);
  const xy = (p: Position) => [
    120 + (p[0] - (minX + maxX) / 2) * correction * scale,
    120 - (p[1] - (minY + maxY) / 2) * scale,
  ];
  return {
    path: polygons
      .map((rings: Polygon["coordinates"]) =>
        rings
          .map(
            (ring) =>
              ring
                .map((p, i) => `${i ? "L" : "M"}${xy(p).join(",")}`)
                .join(" ") + "Z",
          )
          .join(" "),
      )
      .join(" "),
    point: xy(point.coordinates),
  };
}
