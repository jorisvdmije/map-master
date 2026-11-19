import { booleanIntersects } from "@turf/boolean-intersects";
import type { Feature, Point, Polygon, MultiPolygon } from "geojson";

/** Official identifiers stay strings: leading zeroes are significant. */
export function indexById<T>(rows: readonly T[], id: (row: T) => string): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    const key = id(row);
    if (!key || index.has(key)) throw new Error(`Missing or duplicate identifier: ${key}`);
    index.set(key, row);
  }
  return index;
}

/** Includes polygon boundaries, respects holes and multipart geometries. */
export function pointsWithin<T extends Feature<Point>>(points: readonly T[], area: Feature<Polygon | MultiPolygon>): T[] {
  return points.filter(point => booleanIntersects(point, area));
}

/** Same complete pairs for sample size, ranges and unweighted Pearson r. */
export function pairedCorrelation<T>(rows: readonly T[], x: (row: T) => number | null, y: (row: T) => number | null) {
  const pairs = rows.flatMap(row => { const a = x(row), b = y(row); return a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) ? [{ row, x: a, y: b }] : []; });
  const n = pairs.length;
  const mx = pairs.reduce((sum, p) => sum + p.x, 0) / n, my = pairs.reduce((sum, p) => sum + p.y, 0) / n;
  let xx = 0, yy = 0, xy = 0;
  for (const p of pairs) { xx += (p.x - mx) ** 2; yy += (p.y - my) ** 2; xy += (p.x - mx) * (p.y - my); }
  return { pairs, n, r: n >= 5 && xx > 0 && yy > 0 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null };
}
