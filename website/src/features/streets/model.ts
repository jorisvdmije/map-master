import type { Feature, FeatureCollection, MultiLineString, Polygon, MultiPolygon } from "geojson";
import Papa from "papaparse";
import boundaries from "../bnb/wards.json";
import snapshot from "./snapshot.json";
import observationMeta from "./observations-meta.json";
import { overviewGeometry } from "./geometry";

export { snapshot, observationMeta };
export const metrics = ["outages", "lightDensity", "treeDensity", "reports", "nuisance"] as const;
export const clusterMetrics: Metric[] = ["lightDensity", "treeDensity", "reports"];
export type Metric = typeof metrics[number];
export const labels: Record<Metric, string> = { outages: "Verlichtingsstoringen", lightDensity: "Lichtobjectdichtheid", treeDensity: "Boomdichtheid", reports: "Meldingsdruk", nuisance: "Overlastmeldingen" };
export const units: Record<Metric, string> = { outages: "%", lightDensity: "/100 m NWB", treeDensity: "/100 m NWB", reports: "/100 m NWB/maand", nuisance: "/100 m NWB/maand" };
export const descriptions: Record<Metric, string> = { outages: "Aandeel gekoppelde verlichtingsobjecten met een bekende storing, inclusief de broncategorie LSD. Alleen bij minimaal 5 bekende statussen; geen lux- of veiligheidsmeting.", lightDensity: "Gekoppelde verlichtingsobjecten (inclusief LSD) per 100 meter bronwegvaklengte. Een hogere dichtheid is niet automatisch betere verlichting.", treeDensity: "Geregistreerde gemeentelijke bomen nabij de weg, per 100 meter bronwegvaklengte. Geen kroonbedekking of schaduwmeting.", reports: "Publieke MORA-meldingen nabij de weg, per 100 meter bronwegvaklengte per maand. Meldingsbereidheid en drukte beïnvloeden dit aantal.", nuisance: "Subset van MORA met hoofdcategorie Overlast, per 100 meter bronwegvaklengte per maand. Geen criminaliteits- of veiligheidsscore." };
export const thresholds: Record<Metric, [number, number]> = { outages: [2, 10], lightDensity: [2, 5], treeDensity: [1, 4], reports: [1, 4], nuisance: [.2, 1] };
export const highIsMore: Record<Metric, boolean> = { outages: false, lightDensity: true, treeDensity: true, reports: false, nuisance: false };
export type Scores = Record<Metric, number | null>;
export type Counts = { lights: number; known: number; faults: number; trees: number; reports: number[]; nuisance: number[]; maintenance: number[] };
export type ObservationData = { schema: number; retrieved: string; countsSha256: string; roads: Record<string, Counts> };
export type RoadProperties = { id: string; name: string; ward: string; length: number; kind: string };
export type RoadFeature = Feature<MultiLineString, RoadProperties>;
export type Road = RoadProperties & Scores & { geometry: MultiLineString; group: string; raw: Counts; months: number };
export type Observation = Scores & { id: string; name: string; count: number; length: number; ward: string; raw: Counts; months: number };
export type Street = Observation & { roads: Road[]; geometry: MultiLineString; named: boolean; wards: string[] };
export type Status = "all" | "poor" | "medium" | "good" | "missing";
export type Filters = { ward: string | null; query: string; status: Status; cluster: number | null; doubleDeficit: boolean };
export type Cluster = { id: number; color: string; centroid: number[]; members: number };
export const clusterColors = ["#507cb8", "#9b6bb6", "#bd8539", "#368b86", "#b76584", "#7a8c3d"];
export const statusLabels = { poor: "Rood", medium: "Oranje", good: "Groen", missing: "Onvoldoende basis" };
export const statusColors = { poor: "#cc5350", medium: "#e8a03c", good: "#309271", missing: "#94a1ab" };
export const wards = (boundaries as FeatureCollection<Polygon | MultiPolygon, { code: string; name: string }>).features.map(w => ({ ...w, properties: { code: w.properties.code, name: w.properties.name } }));
export const wardNames = new Map([...wards.map(w => [w.properties.code, w.properties.name] as const), ["outside", "Buiten wijkindeling"]]);
export const classify = (value: number | null, metric: Metric): Exclude<Status, "all"> => {
  if (value === null) return "missing";
  const [low, high] = thresholds[metric];
  return highIsMore[metric] ? value < low ? "poor" : value < high ? "medium" : "good" : value < low ? "good" : value < high ? "medium" : "poor";
};
export const scoreColor = (value: number | null, metric: Metric) => statusColors[classify(value, metric)];
export const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const windowTotal = (values: number[], months: number) => sum(values.slice(-months));
export const formatValue = (value: number | null, metric: Metric) => value === null ? "—" : `${value.toLocaleString("nl-NL", { maximumFractionDigits: metric === "outages" ? 1 : 2 })}`;
export function legendLabels(metric: Metric) {
  const [low, high] = thresholds[metric], n = (v: number) => v.toLocaleString("nl-NL");
  const lowLabel = `<${n(low)}`, highLabel = `≥${n(high)}`;
  return { poor: highIsMore[metric] ? lowLabel : highLabel, medium: `${n(low)}–<${n(high)}`, good: highIsMore[metric] ? highLabel : lowLabel, missing: "Onvoldoende basis" };
}
export function combineCounts(rows: Counts[]): Counts {
  return { lights: sum(rows.map(r => r.lights)), known: sum(rows.map(r => r.known)), faults: sum(rows.map(r => r.faults)), trees: sum(rows.map(r => r.trees)),
    reports: Array.from({ length: 12 }, (_, i) => sum(rows.map(r => r.reports[i]!))), nuisance: Array.from({ length: 12 }, (_, i) => sum(rows.map(r => r.nuisance[i]!))), maintenance: Array.from({ length: 12 }, (_, i) => sum(rows.map(r => r.maintenance[i]!))) };
}
/** Ratios of summed numerators/denominators, never averages of segment percentages. */
export function values(raw: Counts, length: number, months: number): Scores {
  return { outages: raw.known >= 5 ? raw.faults / raw.known * 100 : null, lightDensity: length > 0 ? raw.lights / length * 100 : null, treeDensity: length > 0 ? raw.trees / length * 100 : null,
    reports: length > 0 ? windowTotal(raw.reports, months) / length * 100 / months : null, nuisance: length > 0 ? windowTotal(raw.nuisance, months) / length * 100 / months : null };
}
export function createRoads(data: FeatureCollection<MultiLineString, RoadProperties>, observed: ObservationData, months = 12): Road[] {
  if (observed.countsSha256 !== observationMeta.countsSha256 || observed.schema !== 1 || observed.retrieved !== observationMeta.retrieved || Object.keys(observed.roads).length !== data.features.length) throw new Error("De brongegevens passen niet bij het wegenbestand.");
  return data.features.map(f => {
    const raw = observed.roads[f.properties.id]; if (!raw) throw new Error(`Brongegevens ontbreken voor ${f.properties.id}`);
    if ([raw.lights, raw.known, raw.faults, raw.trees, ...raw.reports, ...raw.nuisance, ...raw.maintenance].some(n => !Number.isInteger(n) || n < 0) || raw.known > raw.lights || raw.faults > raw.known || raw.nuisance.some((n, i) => n > raw.reports[i]!) || raw.maintenance.some((n, i) => n > raw.reports[i]!) || [raw.reports, raw.nuisance, raw.maintenance].some(a => a.length !== 12)) throw new Error("Ongeldige bronaantallen.");
    return { ...f.properties, ...values(raw, f.properties.length, months), geometry: f.geometry, group: f.properties.name === "Naamloos wegvak" ? `unnamed:${f.properties.id}` : f.properties.name, raw, months };
  });
}
function observation(id: string, rows: Road[], by: "street" | "ward" = "street"): Observation {
  const raw = combineCounts(rows.map(r => r.raw)), length = sum(rows.map(r => r.length)), months = rows[0]!.months;
  return { id, name: by === "street" ? rows[0]!.name : wardNames.get(id) ?? id, ...values(raw, length, months), raw, months, length, count: rows.length, ward: rows[0]!.ward };
}
export function aggregate(roads: Road[], by: "street" | "ward" = "street"): Observation[] {
  const groups = new Map<string, Road[]>();
  for (const road of roads) {
    if (by === "street" && road.group.startsWith("unnamed:")) continue;
    const id = by === "street" ? road.group : road.ward, rows = groups.get(id); if (rows) rows.push(road); else groups.set(id, [road]);
  }
  return [...groups].map(([id, rows]) => observation(id, rows, by));
}
export function streetScope(roads: Road[], ward: string | null): Street[] {
  const groups = new Map<string, Road[]>();
  for (const road of roads) {
    if (ward && road.ward !== ward) continue;
    const rows = groups.get(road.group); if (rows) rows.push(road); else groups.set(road.group, [road]);
  }
  return [...groups].map(([id, rows]) => ({ ...observation(id, rows), roads: rows, named: !id.startsWith("unnamed:"), wards: [...new Set(rows.map(r => r.ward))], geometry: overviewGeometry(rows) }));
}
export const attentionCount = (s: Scores) => Number(s.outages !== null && s.outages >= 10) + Number(s.treeDensity !== null && s.treeDensity < 1) + Number(s.reports !== null && s.reports >= 4);
export const combinedAttention = (s: Scores) => attentionCount(s) >= 2;
export function filterStreets(streets: Street[], filters: Filters, metric: Metric, assignments: Map<string, number>) {
  const q = filters.query.trim().toLocaleLowerCase("nl");
  return streets.filter(s => (!q || s.name.toLocaleLowerCase("nl").includes(q) || s.roads.some(r => r.id.includes(q))) && (filters.status === "all" || classify(s[metric], metric) === filters.status) && (filters.cluster === null || assignments.get(s.id) === filters.cluster) && (!filters.doubleDeficit || combinedAttention(s)));
}
export function metricDetail(roads: Road[], metric: Metric) {
  const valid = roads.filter(r => r[metric] !== null), length = sum(roads.map(r => r.length)), raw = combineCounts(roads.map(r => r.raw));
  return { average: values(raw, length, roads[0]?.months ?? 12)[metric], min: valid.length ? Math.min(...valid.map(r => r[metric]!)) : null, max: valid.length ? Math.max(...valid.map(r => r[metric]!)) : null, count: valid.length, known: raw.known, lights: raw.lights, faults: raw.faults };
}
export function pearson(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  const mx = mean(x)!, my = mean(y)!;
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < x.length; i++) { const a = x[i]! - mx, b = y[i]! - my; xx += a * a; yy += b * b; xy += a * b; }
  return xx < 1e-12 || yy < 1e-12 ? null : Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)));
}
export function ranks(values: number[]) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value), result = new Array<number>(values.length);
  for (let start = 0; start < order.length;) { let end = start + 1; while (end < order.length && order[end]!.value === order[start]!.value) end++; for (let i = start; i < end; i++) result[order[i]!.index] = (start + end + 1) / 2; start = end; }
  return result;
}
export function association(rows: Observation[], x: Metric, y: Metric, method: "pearson" | "spearman" = "pearson") {
  const pairs = rows.filter(r => r[x] !== null && r[y] !== null);
  const xs = pairs.map(r => r[x]!), ys = pairs.map(r => r[y]!);
  const r = method === "spearman" ? pearson(ranks(xs), ranks(ys)) : pearson(xs, ys);
  const xm = mean(xs), ym = mean(ys);
  let slope: number | null = null;
  if (r !== null && xm !== null && ym !== null) { const xx = xs.reduce((s, v) => s + (v - xm) ** 2, 0); slope = xs.reduce((s, v, i) => s + (v - xm) * (ys[i]! - ym), 0) / xx; }
  return { r, n: pairs.length, excluded: rows.length - pairs.length, pairs, slope, intercept: slope !== null ? ym! - slope * xm! : null };
}
/** Same complete pairs as the density analysis, using raw numerators as a
 * sensitivity check. Neither normalization is a causal correction. */
export function countAssociation(rows: Observation[], x: Metric, y: Metric, method: "pearson" | "spearman") {
  if (x === "outages" || y === "outages") return null;
  const count = (r: Observation, m: Metric) => m === "lightDensity" ? r.raw.lights : m === "treeDensity" ? r.raw.trees : windowTotal(r.raw[m === "nuisance" ? "nuisance" : "reports"], r.months);
  const pairs = rows.filter(r => r[x] !== null && r[y] !== null), xs = pairs.map(r => count(r, x)), ys = pairs.map(r => count(r, y));
  return { r: method === "spearman" ? pearson(ranks(xs), ranks(ys)) : pearson(xs, ys), n: pairs.length };
}
export function associationLabel(r: number | null) { if (r === null) return "Te weinig variatie of meetparen"; const a = Math.abs(r); return `${a < .1 ? "Nauwelijks" : a < .3 ? "Zwak" : a < .6 ? "Matig" : "Sterk"}${a < .1 ? " verband" : r >= 0 ? " positief verband" : " negatief verband"}`; }

/** Deterministic farthest-first k-means on z-scores; trained once per k on all city streets. */
export function clusterStreets(observations: Observation[], requested = 4) {
  const rows = observations.filter(r => r.length >= 100 && clusterMetrics.every(m => r[m] !== null)).sort((a, b) => a.id.localeCompare(b.id));
  if (!rows.length) return { clusters: [] as Cluster[], assignments: new Map<string, number>(), excluded: observations.length, iterations: 0, converged: true, explainedVariance: null as number | null };
  const transformed = rows.map(r => clusterMetrics.map(m => Math.log1p(r[m]!)));
  const means = clusterMetrics.map((_, i) => mean(transformed.map(v => v[i]!))!), std = clusterMetrics.map((_, i) => Math.sqrt(mean(transformed.map(v => (v[i]! - means[i]!) ** 2))!) || 1);
  const vectors = transformed.map(v => v.map((x, i) => (x - means[i]!) / std[i]!));
  const distance = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0);
  const centers = [vectors[0]!.slice()];
  const k = Math.min(Math.max(1, Math.floor(requested) || 1), 6, rows.length);
  while (centers.length < k) { let farthest = vectors[0]!, max = -1; for (const v of vectors) { const d = Math.min(...centers.map(c => distance(v, c))); if (d > max) { max = d; farthest = v; } } if (max < 1e-12) break; centers.push(farthest.slice()); }
  const ids = new Array<number>(rows.length).fill(-1);
  let iterations = 0, converged = false;
  for (; iterations < 60; iterations++) {
    const sums = centers.map(() => clusterMetrics.map(() => 0)), counts = centers.map(() => 0); let changed = false;
    vectors.forEach((v, i) => { let best = 0, d = Infinity; centers.forEach((c, j) => { const next = distance(v, c); if (next < d) { d = next; best = j; } }); if (ids[i] !== best) changed = true; ids[i] = best; counts[best]!++; v.forEach((value, j) => sums[best]![j]! += value); });
    centers.forEach((c, i) => { if (counts[i]) c.forEach((_, j) => c[j] = sums[i]![j]! / counts[i]!); });
    if (!changed) { converged = true; iterations++; break; }
  }
  const populated = centers.map((center, oldId) => ({ center, oldId, members: ids.filter(n => n === oldId).length })).filter(c => c.members > 0);
  const remap = new Map(populated.map((c, id) => [c.oldId, id]));
  const within = vectors.reduce((total, v, i) => total + distance(v, centers[ids[i]!]!), 0), total = vectors.reduce((s, v) => s + distance(v, clusterMetrics.map(() => 0)), 0);
  return { clusters: populated.map(({ center, members }, id) => ({ id, color: clusterColors[id]!, centroid: center.map((v, i) => Math.expm1(v * std[i]! + means[i]!)), members })), assignments: new Map(rows.map((r, i) => [r.id, remap.get(ids[i]!)!])), excluded: observations.length - rows.length, iterations, converged, explainedVariance: total > 1e-12 ? Math.max(0, Math.min(1, 1 - within / total)) : null };
}
export function summary(roads: Road[], metric: Metric) {
  const raw = combineCounts(roads.map(r => r.raw)), length = sum(roads.map(r => r.length));
  return { raw, average: values(raw, length, roads[0]?.months ?? 12)[metric], km: length / 1000 };
}
const provenance = { datatype: "observed_counts_derived_spatially", peildatum_download: observationMeta.retrieved, bron_geometrie: "Rijkswaterstaat NWB / PDOK", bronnen: "Gemeente Amsterdam: openbare verlichting, bomen, MORA", koppeling: "nearest NWB <=30m; ambiguous different names <3m excluded", noemer: "bronwegvaklengte; parallelle rijbanen tellen apart", nul_betekenis: "geen gekoppelde registratie; geen bewezen afwezigheid" };
function record(s: Observation, assignments: Map<string, number>) {
  return { id: s.id, naam: s.name, lengte_m: s.length, ...Object.fromEntries(metrics.map(m => [`${m} (${units[m]})`, s[m] ?? ""])), lichtobjecten: s.raw.lights, bekende_objectstatussen: s.raw.known, storingen: s.raw.faults, bomen: s.raw.trees, meldingen: windowTotal(s.raw.reports, s.months), overlastmeldingen: windowTotal(s.raw.nuisance, s.months), wegonderhoudmeldingen: windowTotal(s.raw.maintenance, s.months), maanden: s.months, periode_van: observationMeta.months[12 - s.months], periode_tot_exclusief: observationMeta.reportEndExclusive, profiel: assignments.has(s.id) ? assignments.get(s.id)! + 1 : "", ...provenance };
}
export function roadGeoJSON(roads: Road[], assignments: Map<string, number>): FeatureCollection<MultiLineString> {
  return { type: "FeatureCollection", features: roads.map(r => ({ type: "Feature", id: r.id, geometry: r.geometry, properties: { ...record({ ...r, count: 1 }, new Map()), name: r.name, ward: r.ward, kind: r.kind, ...Object.fromEntries(metrics.map(m => [m, r[m]])), profiel: assignments.has(r.group) ? assignments.get(r.group)! + 1 : null } })) };
}
export function roadCSV(roads: Road[], assignments: Map<string, number>) {
  return Papa.unparse(roads.map(r => ({ ...record({ ...r, count: 1 }, new Map()), wijk: wardNames.get(r.ward), profiel: assignments.has(r.group) ? assignments.get(r.group)! + 1 : "" })), { escapeFormulae: true });
}
export function streetCSV(streets: Street[], assignments: Map<string, number>) {
  return Papa.unparse(streets.map(s => ({ ...record(s, assignments), wijken: s.wards.map(w => wardNames.get(w)).join(" / "), wegvakken: s.count })), { escapeFormulae: true });
}
