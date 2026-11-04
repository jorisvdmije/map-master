import type { FeatureCollection, Point, Polygon } from "geojson";
import { observationMeta, snapshot, type Road } from "./model";

export const heatKinds = ["reports", "nuisance", "maintenance", "trees", "lights", "faults"] as const;
export type HeatKind = typeof heatKinds[number];
export const heatLabels: Record<HeatKind, string> = { reports: "Alle meldingen", nuisance: "Overlastmeldingen", maintenance: "Wegen & onderhoud", trees: "Gemeentelijke bomen", lights: "Verlichtingsobjecten", faults: "Verlichtingsstoringen" };
export type HeatSettings = { kind: HeatKind; radius: number; contrast: number; shape: "smooth" | "hex" };
export const defaultHeat: HeatSettings = { kind: "reports", radius: 250, contrast: 1, shape: "smooth" };
// [road index, grid x, grid y, tree count, light objects, faults, sparse month/all/nuisance/maintenance]
export type HeatCell = [number, number, number, number, number, number, number[]];
export type HeatData = { schema: number; countsSha256: string; cellMetres: number; origin: number[]; metresPerDegree: number[]; roadIds: string[]; cells: HeatCell[] };
export type HeatProperties = { id: string; count: number; names: string[] };
export type HeatCollection = FeatureCollection<Point, HeatProperties>;
export type HeatView = { data: HeatCollection; total: number; cells: number; kind: HeatKind; months: number; polygons?: FeatureCollection<Polygon, HeatProperties>; hexWidth?: number };

export function validateHeat(data: HeatData) {
  if (!data || data.schema !== 1 || data.countsSha256 !== observationMeta.countsSha256 || data.cellMetres !== 25 || !Array.isArray(data.origin) || data.origin.join() !== "4.9,52.37" || !Array.isArray(data.metresPerDegree) || data.metresPerDegree.join() !== "67900,111200" || !Array.isArray(data.roadIds) || data.roadIds.length !== snapshot.count || new Set(data.roadIds).size !== snapshot.count || !Array.isArray(data.cells)) throw new Error("De concentratiegegevens passen niet bij de straatgegevens.");
  for (const c of data.cells) {
    if (!Array.isArray(c) || c.length !== 7 || !c.slice(0, 6).every(Number.isInteger) || c[0] < 0 || c[0] >= data.roadIds.length || c.slice(3, 6).some(n => Number(n) < 0) || c[5] > c[4] || !Array.isArray(c[6]) || c[6].length % 4) throw new Error("Ongeldig bronvak in concentratiegegevens.");
    let prior = -1;
    for (let i = 0; i < c[6].length; i += 4) {
      const [month, all, nuisance, maintenance] = c[6].slice(i, i + 4);
      if (!c[6].slice(i, i + 4).every(n => Number.isInteger(n) && n >= 0) || month! > 11 || month! <= prior || nuisance! > all! || maintenance! > all!) throw new Error("Ongeldige maandcijfers in concentratiegegevens.");
      prior = month!;
    }
  }
  return data;
}
export function heatCount(cell: HeatCell, kind: HeatKind, months: number) {
  if (kind === "trees") return cell[3]; if (kind === "lights") return cell[4]; if (kind === "faults") return cell[5];
  const offset = kind === "reports" ? 1 : kind === "nuisance" ? 2 : 3; let total = 0;
  for (let i = 0; i < cell[6].length; i += 4) if (cell[6][i]! >= 12 - months) total += cell[6][i + offset]!;
  return total;
}
/** Original locations binned to 25 m. Counters remain linear; no invented street centroids. */
export function buildHeat(data: HeatData, roads: Road[], kind: HeatKind, months: number): HeatView {
  const visible = new Map(roads.map(r => [r.id, r.group]));
  const bins = new Map<string, { x: number; y: number; count: number; names: Set<string> }>(); let total = 0;
  for (const cell of data.cells) {
    const name = visible.get(data.roadIds[cell[0]]!); if (name === undefined) continue;
    const count = heatCount(cell, kind, months); if (!count) continue;
    const id = `${cell[1]}:${cell[2]}`, bin = bins.get(id);
    if (bin) { bin.count += count; bin.names.add(name); } else bins.set(id, { x: cell[1], y: cell[2], count, names: new Set([name]) });
    total += count;
  }
  return { kind, months, total, cells: bins.size, data: { type: "FeatureCollection", features: [...bins].map(([id, bin]) => ({ type: "Feature", id, geometry: { type: "Point", coordinates: [data.origin[0]! + (bin.x + .5) * 25 / data.metresPerDegree[0]!, data.origin[1]! + (bin.y + .5) * 25 / data.metresPerDegree[1]!] }, properties: { id, count: bin.count, names: [...bin.names].sort() } })) } };
}
/** Global p95 over radius-sized bins, using 12 months even for a quarter.
 * Unchanged by viewport/filters so filtering cannot silently amplify the map.
 */
export function heatReference(data: HeatData, kind: HeatKind, radius: number) {
  const bins = new Map<string, number>();
  for (const c of data.cells) {
    const count = heatCount(c, kind, 12); if (!count) continue;
    const id = `${Math.floor((c[1] + .5) * 25 / radius)}:${Math.floor((c[2] + .5) * 25 / radius)}`;
    bins.set(id, (bins.get(id) ?? 0) + count);
  }
  const ordered = [...bins.values()].sort((a, b) => a - b);
  return Math.max(1, ordered[Math.floor((ordered.length - 1) * .95)] ?? 1);
}
export const heatPalette = (kind: HeatKind): [number, string][] => kind === "trees"
  ? [[0, "rgba(196,228,210,0)"], [.12, "rgba(160,210,181,0.08)"], [.3, "rgba(108,184,151,0.4)"], [.5, "rgba(55,148,127,0.7)"], [.75, "rgba(28,106,102,0.88)"], [1, "rgba(19,67,79,0.96)"]]
  : [[0, "rgba(250,224,163,0)"], [.12, "rgba(248,215,144,0.08)"], [.3, "rgba(240,183,91,0.42)"], [.5, "rgba(224,130,72,0.72)"], [.75, "rgba(190,69,58,0.88)"], [1, "rgba(116,35,57,0.96)"]];
export const heatGradient = (kind: HeatKind) => `linear-gradient(90deg, ${heatPalette(kind).map(([stop, color]) => `${color} ${stop * 100}%`).join(", ")})`;

/** Pointy-top regular hexagons in the same local metre projection as the source grid.
 * width is the distance between parallel sides, not a smoothing/search radius.
 */
export function hexAddress(x: number, y: number, width: number) {
  const size = width / Math.sqrt(3), q = (Math.sqrt(3) / 3 * x - y / 3) / size, r = 2 / 3 * y / size;
  let a = Math.round(q), b = Math.round(-q - r), c = Math.round(r);
  const da = Math.abs(a - q), db = Math.abs(b + q + r), dc = Math.abs(c - r);
  if (da > db && da > dc) a = -b - c; else if (db > dc) b = -a - c; else c = -a - b;
  void b;
  return { q: a, r: c };
}
export function hexagons(view: HeatView, width: number): HeatView {
  if (![100, 250, 500].includes(width)) throw new Error("Ongeldige hexagonbreedte");
  const groups = new Map<string, { q: number; r: number; count: number; names: Set<string> }>();
  for (const f of view.data.features) {
    const [lng, lat] = f.geometry.coordinates;
    const { q, r } = hexAddress((lng! - 4.9) * 67900, (lat! - 52.37) * 111200, width), id = `h:${width}:${q}:${r}`;
    const bin = groups.get(id);
    if (bin) { bin.count += f.properties.count; for (const name of f.properties.names) bin.names.add(name); }
    else groups.set(id, { q, r, count: f.properties.count, names: new Set(f.properties.names) });
  }
  const points: HeatCollection["features"] = [], polygons: FeatureCollection<Polygon, HeatProperties> = { type: "FeatureCollection", features: [] }, size = width / Math.sqrt(3);
  const toWgs = (x: number, y: number) => [4.9 + x / 67900, 52.37 + y / 111200];
  for (const [id, bin] of groups) {
    const x = width * (bin.q + bin.r / 2), y = 1.5 * size * bin.r, properties = { id, count: bin.count, names: [...bin.names].sort() };
    points.push({ type: "Feature", id, properties, geometry: { type: "Point", coordinates: toWgs(x, y) } });
    const ring = Array.from({ length: 6 }, (_, i) => { const angle = (60 * i - 30) * Math.PI / 180; return toWgs(x + size * Math.cos(angle), y + size * Math.sin(angle)); });
    ring.push(ring[0]!.slice()); polygons.features.push({ type: "Feature", id, properties, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  return { ...view, cells: points.length, data: { type: "FeatureCollection", features: points }, polygons, hexWidth: width };
}
export function hexReference(data: HeatData, kind: HeatKind, width: number) {
  const bins = new Map<string, number>();
  for (const c of data.cells) {
    const count = heatCount(c, kind, 12); if (!count) continue;
    const { q, r } = hexAddress((c[1] + .5) * 25, (c[2] + .5) * 25, width), id = `${q}:${r}`;
    bins.set(id, (bins.get(id) ?? 0) + count);
  }
  const sorted = [...bins.values()].sort((a, b) => a - b);
  return Math.max(1, sorted[Math.floor((sorted.length - 1) * .95)] ?? 1);
}
export const hexPalette = (kind: HeatKind): [number, string][] => kind === "trees"
  ? [[0, "#e3efe3"], [.2, "#bad9c5"], [.45, "#7cb89e"], [.7, "#408f80"], [1, "#195b63"]]
  : [[0, "#fff0d0"], [.2, "#f5d394"], [.45, "#e9a66b"], [.7, "#ce735c"], [1, "#8e3c53"]];
export const hexGradient = (kind: HeatKind) => `linear-gradient(90deg, ${hexPalette(kind).map(([stop, color]) => `${color} ${stop * 100}%`).join(", ")})`;
