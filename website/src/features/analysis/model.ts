import { validateGeoJSON } from "@jorisvdmije/map-master";
import { booleanIntersects } from "@turf/boolean-intersects";
import { area } from "@turf/area";
import { bbox } from "@turf/bbox";
import Papa from "papaparse";
import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon, Position } from "geojson";

export type DataGeometry = Exclude<Geometry, { type: "GeometryCollection" }>;
export type DataFeature = Feature<DataGeometry, Record<string, unknown>>;
export type Dataset = { name: string; data: FeatureCollection<DataGeometry, Record<string, unknown>> };
export type AnalysisArea = Feature<Polygon | MultiPolygon>;
export type Filters = { category: string | null; range: [number, number] | null; rangeExclusive?: boolean; query: string };
export type Fields = { category: string; metric: string; size: boolean };
export const colors = ["#27836d", "#ce8747", "#648bc3", "#9c78b5", "#c16e7d", "#9a994b", "#5d9d9e", "#967d66"];
export const limit = 20_000;
export const fileLimit = 10 * 1024 * 1024;
export const savedFileLimit = 50 * 1024 * 1024;
export const emptyFilters: Filters = { category: null, range: null, query: "" };
export const valueLabel = (value: unknown): string => value == null || value === "" ? "(Missing)" : typeof value === "object" ? JSON.stringify(value) : String(value);
export const categoryKey = (value: unknown): string => value == null || value === "" ? "missing:" : `${typeof value}:${valueLabel(value)}`;
export const numericValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Validate before publishing any state; a bad row never silently disappears. */
export function parseGeoJSON(input: unknown, name: string): Dataset {
  const candidates = record(input) && input.type === "FeatureCollection" ? input.features : [input];
  if (!Array.isArray(candidates) || candidates.length > limit) throw new Error(`Use a FeatureCollection with at most ${limit.toLocaleString()} features.`);
  let vertices = 0;
  const position = (value: unknown): value is Position => {
    if (++vertices > 300_000) throw new Error("This file exceeds the 300,000-coordinate limit.");
    return Array.isArray(value) && value.length >= 2 && value.every(n => typeof n === "number" && Number.isFinite(n)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
  };
  const line = (value: unknown, ring = false): boolean => Array.isArray(value) && value.length >= (ring ? 4 : 2) && value.every(position) && (!ring || value[0]![0] === value.at(-1)![0] && value[0]![1] === value.at(-1)![1]);
  const polygon = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(ring => line(ring, true));
  const features = candidates.map((feature: unknown, index): DataFeature => {
    const fail = () => new Error(`Feature ${index + 1} is invalid. Use WGS84 longitude/latitude and closed polygon rings. Supported: Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon.`);
    if (!record(feature) || feature.type !== "Feature" || !record(feature.geometry) || feature.properties !== null && !record(feature.properties)) throw fail();
    const { type, coordinates } = feature.geometry;
    const valid = type === "Point" ? position(coordinates)
      : type === "MultiPoint" ? Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(position)
      : type === "LineString" ? line(coordinates)
      : type === "MultiLineString" ? Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(l => line(l))
      : type === "Polygon" ? polygon(coordinates)
      : type === "MultiPolygon" ? Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(polygon) : false;
    if (!valid) throw fail();
    if (type === "Polygon" || type === "MultiPolygon") {
      // Analysis preserves extra ordinates and arbitrary source properties. Only
      // its 2D polygon topology uses the shared strict editor contract.
      const xy = (rings: Position[][]) => rings.map(ring => ring.map(p => p.slice(0, 2)));
      try {
        validateGeoJSON({ type: "Feature", properties: null, geometry: { type, coordinates: type === "Polygon" ? xy(coordinates as Position[][]) : (coordinates as Position[][][]).map(xy) } });
      } catch (error) { throw new Error(`Feature ${index + 1} has invalid polygon topology: ${error instanceof Error ? error.message : "invalid rings"}`); }
    }
    if (feature.id !== undefined && typeof feature.id !== "string" && !(typeof feature.id === "number" && Number.isFinite(feature.id))) throw fail();
    return { type: "Feature", ...(feature.id === undefined ? {} : { id: feature.id as string | number }), geometry: feature.geometry as unknown as DataGeometry, properties: { ...feature.properties as Record<string, unknown> | null } };
  });
  return { name: name.slice(0, 150), data: { type: "FeatureCollection", features } };
}

export type CsvInput = { headers: string[]; rows: string[][]; longitude: string; latitude: string };
export function parseCSV(text: string): CsvInput {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/u, ""), { skipEmptyLines: "greedy" });
  const error = parsed.errors.find(error => error.code !== "UndetectableDelimiter");
  if (error) throw new Error(`CSV ${error.row === undefined ? "" : `row ${error.row + 1}: `}${error.message}`);
  const [raw, ...rows] = parsed.data;
  const headers = raw?.map(h => h.trim()) ?? [];
  if (headers.length < 2 || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error("CSV needs at least two unique, non-empty column names.");
  if (rows.length > limit || rows.some(row => row.length !== headers.length)) throw new Error(`CSV needs consistent columns and at most ${limit.toLocaleString()} rows.`);
  const find = (pattern: RegExp) => headers.find(h => pattern.test(h)) ?? "";
  return { headers, rows, longitude: find(/^(lon|lng|long|longitude|x)$/iu), latitude: find(/^(lat|latitude|y)$/iu) };
}
export function csvDataset(csv: CsvInput, longitude: string, latitude: string, name: string): Dataset {
  const x = csv.headers.indexOf(longitude), y = csv.headers.indexOf(latitude);
  if (x < 0 || y < 0 || x === y) throw new Error("Choose different longitude and latitude columns.");
  const features = csv.rows.map((row, index) => {
    if (!row[x]!.trim() || !row[y]!.trim() || !Number.isFinite(Number(row[x])) || !Number.isFinite(Number(row[y]))) throw new Error(`CSV row ${index + 2} needs valid longitude and latitude. No rows were imported.`);
    return { type: "Feature", geometry: { type: "Point", coordinates: [Number(row[x]), Number(row[y])] }, properties: Object.fromEntries(csv.headers.map((h, i) => {
      const value = row[i]!.trim();
      // Preserve identifiers with leading zeros. Empty cells are missing, never zero.
      const numeric = /^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[-+]?\d+)?$/iu.test(value) && Number.isFinite(Number(value));
      return [h, value === "" ? null : numeric ? Number(value) : value];
    })) };
  });
  return parseGeoJSON({ type: "FeatureCollection", features }, name);
}

export function schema(dataset: Dataset) {
  const fields = [...new Set(dataset.data.features.flatMap(f => Object.keys(f.properties)))].sort();
  return { fields, numeric: fields.filter(key => dataset.data.features.some(f => numericValue(f.properties[key]) !== null)) };
}
export function defaultFields(dataset: Dataset): Fields {
  const { fields, numeric } = schema(dataset);
  return { category: fields.find(key => /^(category|type|status)$/iu.test(key)) ?? fields.find(key => !numeric.includes(key)) ?? "", metric: numeric.find(key => !/^(id|lat|lon|latitude|longitude|x|y)$/iu.test(key)) ?? numeric[0] ?? "", size: false };
}
export type Category = { key: string; label: string; count: number; color: string };
export function categories(features: DataFeature[], field: string): Category[] {
  const groups = new Map<string, Category>();
  for (const feature of features) {
    const value = field ? feature.properties[field] : "All features", key = categoryKey(value);
    const group = groups.get(key);
    if (group) group.count++; else groups.set(key, { key, label: valueLabel(value), count: 1, color: "" });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).map((g, i) => ({ ...g, color: colors[i % colors.length]! }));
}

/** An object touching any part of an area counts once, including its boundary. */
export function spatialRows(dataset: Dataset, selected: AnalysisArea | null): number[] {
  const bounds = selected ? bbox(selected) : null;
  return dataset.data.features.flatMap((feature, index) => {
    if (!selected || !bounds) return [index];
    const b = bbox(feature);
    if (b[0]! > bounds[2]! || b[2]! < bounds[0]! || b[1]! > bounds[3]! || b[3]! < bounds[1]!) return [];
    return booleanIntersects(feature, selected) ? [index] : [];
  });
}
export function filterRows(dataset: Dataset, rows: number[], fields: Fields, filters: Filters): number[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter(i => {
    const f = dataset.data.features[i]!;
    const value = numericValue(f.properties[fields.metric]);
    return (filters.category === null || categoryKey(fields.category ? f.properties[fields.category] : "All features") === filters.category)
      && (!filters.range || value !== null && value >= filters.range[0] && (filters.rangeExclusive ? value < filters.range[1] : value <= filters.range[1]))
      && (!query || Object.values(f.properties).some(v => valueLabel(v).toLocaleLowerCase().includes(query)));
  });
}
export function summarize(features: DataFeature[], metric: string) {
  const values = features.map(f => numericValue(f.properties[metric])).filter(v => v !== null).sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  const quantile = (p: number) => { if (!values.length) return null; const index = (values.length - 1) * p, lo = Math.floor(index), weight = index - lo; return values[lo]! * (1 - weight) + values[Math.ceil(index)]! * weight; };
  return { count: features.length, valid: values.length, missing: features.length - values.length, sum: values.length ? sum : null, average: values.length ? sum / values.length : null, min: values[0] ?? null, max: values.at(-1) ?? null, median: quantile(.5), q1: quantile(.25), q3: quantile(.75) };
}
export function histogram(features: DataFeature[], metric: string) {
  const values = features.map(f => numericValue(f.properties[metric])).filter(v => v !== null);
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values);
  const count = min === max ? 1 : 6, width = (max - min) / count;
  return Array.from({ length: count }, (_, i) => {
    const lower = min + i * width, upper = i === count - 1 ? max : min + (i + 1) * width, exclusive = i < count - 1;
    return { min: lower, max: upper, exclusive, count: values.filter(v => v >= lower && (exclusive ? v < upper : v <= upper)).length };
  });
}
export const areaKm2 = (selected: AnalysisArea | null) => selected ? area(selected) / 1_000_000 : null;
export function exportCSV(features: DataFeature[]): string {
  const fields = [...new Set(features.flatMap(f => Object.keys(f.properties)))];
  const unique = (base: string) => { let name = base; while (fields.includes(name)) name = `_${name}`; return name; };
  // Geometry stays available for non-point data; CSV is not a lossy points-only export.
  return Papa.unparse({ fields: [unique("feature_id"), unique("longitude"), unique("latitude"), ...fields, unique("geometry_geojson")], data: features.map(f => [f.id ?? "", f.geometry.type === "Point" ? f.geometry.coordinates[0] : "", f.geometry.type === "Point" ? f.geometry.coordinates[1] : "", ...fields.map(k => typeof f.properties[k] === "object" && f.properties[k] !== null ? JSON.stringify(f.properties[k]) : f.properties[k] ?? ""), JSON.stringify(f.geometry)]) }, { escapeFormulae: true });
}

export function demoDataset(): Dataset {
  // Seeded, uneven spatial patterns make comparisons repeatable without a lattice.
  // These are invented locations, not real reports or geocoded street addresses.
  let seed = 20261103;
  const random = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(random(), Number.EPSILON))) * Math.cos(2 * Math.PI * random());
  const districts = [
    { name: "Centre", centre: [4.895, 52.371], spread: [.0065, .0033], weights: [.57, .2, .16, .07] },
    { name: "West", centre: [4.871, 52.373], spread: [.005, .0036], weights: [.23, .4, .25, .12] },
    { name: "South", centre: [4.897, 52.353], spread: [.006, .0028], weights: [.15, .14, .27, .44] },
    { name: "East", centre: [4.928, 52.365], spread: [.0042, .0042], weights: [.19, .21, .42, .18] },
  ];
  const names = ["Waste", "Street lighting", "Road surface", "Green spaces"];
  const features: DataFeature[] = Array.from({ length: 144 }, (_, i) => {
    const location = random();
    const district = districts[location < .38 ? 0 : location < .62 ? 1 : location < .83 ? 2 : 3]!;
    const x = normal(), y = normal(), spread = random() < .13 ? 2.1 : 1;
    let category = 0, remainder = random();
    while (category < names.length - 1 && remainder > district.weights[category]!) remainder -= district.weights[category++]!;
    const resolved = random() < .38;
    const baseCost = [80, 230, 680, 150][category]!;
    const cost = random() < .06 ? null : Math.round((baseCost + -Math.log(Math.max(random(), Number.EPSILON)) * baseCost * 1.4) / 5) * 5;
    return { type: "Feature", id: `request-${i + 1}`, geometry: { type: "Point", coordinates: [Number((district.centre[0]! + (x + .35 * y) * district.spread[0]! * spread).toFixed(6)), Number((district.centre[1]! + y * district.spread[1]! * spread).toFixed(6))] },
      properties: { name: `Request ${String(i + 1).padStart(3, "0")}`, category: names[category], district: district.name, status: resolved ? "Resolved" : "Open", cost, days_open: resolved ? 0 : 1 + Math.min(45, Math.floor(-Math.log(Math.max(random(), Number.EPSILON)) * 9)) } };
  });
  return { name: "Amsterdam · service requests", data: { type: "FeatureCollection", features } };
}
export const demoArea: AnalysisArea = { type: "Feature", id: "demo-centre", properties: { name: "City centre" }, geometry: { type: "Polygon", coordinates: [[[4.88, 52.36], [4.917, 52.36], [4.917, 52.382], [4.88, 52.382], [4.88, 52.36]]] } };
